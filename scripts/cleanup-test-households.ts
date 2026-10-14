import { eq, sql } from 'drizzle-orm';

import { db, households, sql as pgClient } from '../lib/db/index.ts';

/**
 * Faxina dos households de TESTE orfaos no banco (residuo de suites que
 * deveriam apagar o proprio household no `finally`).
 *
 * Por padrao e DRY-RUN: so LISTA os candidatos, sem escrever nada.
 *
 *   node --env-file=.env.local scripts/cleanup-test-households.ts
 *
 * Apaga de verdade so com a flag explicita `--execute` E o id do household
 * real em `--keep` (a decisao de apagar e do Ricardo):
 *
 *   node --env-file=.env.local scripts/cleanup-test-households.ts --execute --keep <uuid-da-Casa>
 *
 * Garantias:
 * - dry-run nao executa nenhum INSERT/UPDATE/DELETE (so SELECT);
 * - `--execute` exige `--keep` com o uuid do household real, e aborta se esse
 *   id nao existir no banco (protecao contra digitacao errada);
 * - mesmo com `--execute`, NUNCA apaga household que tenha membro com e-mail
 *   fora dos dominios de teste, que tenha lotes de importacao, ou cujo nome
 *   nao bata com o padrao de teste — a Casa real e excluida por TRES
 *   criterios independentes, nao so pelo `--keep`;
 * - a exclusao roda numa UNICA transacao (ou sai tudo, ou nao sai nada).
 */

type Candidate = {
  id: string;
  name: string;
  createdAt: Date;
  members: number;
  testEmails: number;
  realEmails: number;
  txs: number;
  batches: number;
};

/** Dominios que os testes usam nos e-mails de membro (`@teste.local`, `@teste.invalid`, `@example.test`). */
const TEST_EMAIL_SUFFIXES = ['@teste.local', '@teste.invalid', '@example.test'] as const;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseArgs(argv: string[]): { execute: boolean; keep: string | null } {
  let execute = false;
  let keep: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') {
      execute = true;
    } else if (arg === '--keep') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error('`--keep` exige o uuid do household real em seguida.');
      }
      keep = next;
      i += 1;
    } else {
      throw new Error(`Opcao desconhecida: ${arg}. Uso: [--execute --keep <uuid>]`);
    }
  }
  return { execute, keep };
}

/** Candidatos: nome com pinta de teste. A exclusao do real vem dos guardas abaixo, nao so do nome. */
async function listCandidates(): Promise<Candidate[]> {
  const rows = await db.execute(sql`
    select h.id,
           h.name,
           h.created_at as "createdAt",
           count(distinct m.id)::int as members,
           count(distinct case
             when ${sql.join(
               TEST_EMAIL_SUFFIXES.map((suffix) => sql`m.email ilike ${`%${suffix}`}`),
               sql` or `,
             )} then m.id
           end)::int as "testEmails",
           count(distinct case
             when m.id is not null and not (${sql.join(
               TEST_EMAIL_SUFFIXES.map((suffix) => sql`m.email ilike ${`%${suffix}`}`),
               sql` or `,
             )}) then m.id
           end)::int as "realEmails",
           (select count(*)::int from transactions t where t.household_id = h.id) as txs,
           (select count(*)::int from import_batches b where b.household_id = h.id) as batches
      from households h
      left join members m on m.household_id = h.id
     where h.name ilike '%test%'
     group by h.id
     order by h.created_at`);
  return rows as unknown as Candidate[];
}

/**
 * Guardas que NUNCA deixam um household real entrar na exclusao, mesmo com
 * `--execute`: o `--keep`, qualquer e-mail fora dos dominios de teste, e
 * qualquer lote de importacao (teste nao importa lote que fique).
 */
function deletable(candidate: Candidate, keep: string): boolean {
  if (candidate.id.toLowerCase() === keep.toLowerCase()) return false;
  if (candidate.realEmails > 0) return false;
  if (candidate.batches > 0) return false;
  return true;
}

async function main(): Promise<void> {
  const { execute, keep } = parseArgs(process.argv.slice(2));

  if (execute) {
    if (keep === null) {
      throw new Error('`--execute` exige `--keep <uuid-do-household-real>`. Sem ele, nada e apagado.');
    }
    if (!isUuid(keep)) {
      throw new Error(`\`--keep\` nao e um uuid valido: ${keep}`);
    }
    const [real] = await db
      .select({ id: households.id, name: households.name })
      .from(households)
      .where(eq(households.id, keep))
      .limit(1);
    if (real === undefined) {
      throw new Error(`O household de \`--keep\` (${keep}) nao existe no banco. Abortando sem apagar nada.`);
    }
    console.log(`Household real preservado: ${real.id} (${real.name}).`);
  }

  const candidates = await listCandidates();
  if (execute && keep !== null) {
    const blocked = candidates.filter((candidate) => !deletable(candidate, keep));
    const targets = candidates.filter((candidate) => deletable(candidate, keep));
    for (const candidate of blocked) {
      console.log(
        `PULADO (guarda): ${candidate.id} (${candidate.name}) ` +
          `membrosReais=${candidate.realEmails} lotes=${candidate.batches}`,
      );
    }
    if (targets.length === 0) {
      console.log('Nada a apagar: nenhum candidato passou pelos guardas.');
      return;
    }
    console.log(`Apagando ${targets.length} households de teste em UMA transacao...`);
    await db.transaction(async (tx) => {
      const ids = targets.map((candidate) => candidate.id);
      // Mesma ordem do cleanup dos testes (FKs RESTRICT sao imediatas):
      // reabre as conciliadas e solta o pagamento de fatura antes de apagar.
      await tx.execute(
        sql`update transactions set status = 'planned', reconciled_by_transaction_id = null where household_id in (select unnest(${ids}::uuid[])) and status = 'reconciled'`,
      );
      await tx.execute(
        sql`update statements set paid_transaction_id = null where credit_card_id in (select id from credit_cards where household_id in (select unnest(${ids}::uuid[])))`,
      );
      await tx.execute(
        sql`delete from transactions where household_id in (select unnest(${ids}::uuid[]))`,
      );
      await tx.execute(
        sql`delete from import_batches where household_id in (select unnest(${ids}::uuid[]))`,
      );
      await tx.execute(
        sql`delete from households where id in (select unnest(${ids}::uuid[]))`,
      );
    });
    for (const candidate of targets) {
      console.log(`APAGADO: ${candidate.id} (${candidate.name})`);
    }
    console.log(`Feito: ${targets.length} apagados, ${blocked.length} pulados pelos guardas.`);
    return;
  }

  // Dry-run: so lista, sem escrever nada.
  console.log(`DRY-RUN: ${candidates.length} candidatos (nome com 'test'). Nada foi apagado.`);
  for (const candidate of candidates.slice(0, 10)) {
    console.log(
      `${new Date(candidate.createdAt).toISOString()} | txs=${candidate.txs} lotes=${candidate.batches} ` +
        `membros=${candidate.members} | ${candidate.id} | ${candidate.name}`,
    );
  }
  if (candidates.length > 10) {
    console.log(`... e mais ${candidates.length - 10} (lista completa no SELECT, sem limite para apagar).`);
  }
  console.log('Para apagar de verdade (decisao do Ricardo):');
  console.log('  node --env-file=.env.local scripts/cleanup-test-households.ts --execute --keep <uuid-da-Casa>');
}

main()
  .then(async () => {
    await pgClient.end();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await pgClient.end();
    process.exit(1);
  });
