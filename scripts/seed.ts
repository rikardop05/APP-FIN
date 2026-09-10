import { createHash } from 'node:crypto';

import {
  categories,
  categorizationRules,
  households,
  householdSettings,
  members,
  db,
  sql,
} from '../lib/db/index.ts';

import type { CategoryNature, MatchType } from '../lib/db/enums.ts';

/**
 * Seed obrigatorio de DATA-MODEL §3: 1 household, 2 members,
 * 1 household_settings, a arvore de categorias pt-BR com `nature` preenchida e
 * as regras iniciais de categorizacao.
 *
 * **Idempotente por construcao.** Nenhum id e sorteado: todos derivam de uma
 * chave estavel por UUIDv5, e todo insert usa `on conflict do nothing`. Rodar
 * duas vezes tem o mesmo efeito de rodar uma. E o que o aceite do T-002b vai
 * verificar contra o banco de verdade; aqui a garantia e estrutural.
 *
 * Rode com: `npm run db:seed`
 */

// ---------------------------------------------------------------------------
// UUID determinístico
// ---------------------------------------------------------------------------

/** Namespace fixo do APPFIN. Trocar isto reescreve todos os ids do seed. */
const NAMESPACE = '6f1c2a54-3b7e-4d81-9a05-8c2e4f7b1d63';

/**
 * UUIDv5 (RFC 4122, §4.3): sha1 do namespace + nome, com versao e variante
 * fixadas. Mesma entrada, mesmo id, em qualquer maquina e em qualquer run.
 */
function uuidv5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();

  const bytes = Uint8Array.prototype.slice.call(hash, 0, 16);
  // Versao 5 nos 4 bits altos do byte 6.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // Variante RFC 4122 nos 2 bits altos do byte 8.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Household, membros e ajustes
// ---------------------------------------------------------------------------

const HOUSEHOLD_ID = uuidv5('household:principal');

/**
 * Os e-mails da allowlist vem do ambiente (RNF-01, e CONVENTIONS §9: segredo e
 * dado pessoal nao ficam em arquivo versionado). `AUTH_ALLOWED_EMAILS` e a
 * mesma variavel que o T-004 usa para recusar login fora da lista.
 */
function readAllowlist(): readonly [string, string] {
  const raw = process.env.AUTH_ALLOWED_EMAILS ?? '';
  const emails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  if (emails.length !== 2) {
    throw new Error(
      `AUTH_ALLOWED_EMAILS precisa ter exatamente 2 e-mails separados por virgula; recebi ${emails.length}. ` +
        'Preencha em .env.local antes de rodar o seed.',
    );
  }
  // Os dois membros precisam ser distintos: `members.email` e unique, entao um
  // e-mail repetido gravaria um membro so e o seed anunciaria dois.
  if (emails[0] === emails[1]) {
    throw new Error(
      `AUTH_ALLOWED_EMAILS tem o mesmo e-mail duas vezes (${emails[0]}). ` +
        'O household tem 2 membros distintos (SPEC §2, multiusuario).',
    );
  }
  return [emails[0]!, emails[1]!];
}

// `as const` so fixa os dois literais de cor como somente-leitura; e dado de
// exibicao, nada os reatribui (CONVENTIONS §6, justificativa do `as`).
const MEMBER_COLORS = ['#2563eb', '#db2777'] as const;

// ---------------------------------------------------------------------------
// Árvore de categorias — DATA-MODEL §3, item 2
// ---------------------------------------------------------------------------

type ChildSeed = { name: string; nature: CategoryNature };
type RootSeed = {
  name: string;
  nature: CategoryNature;
  children?: readonly ChildSeed[];
};

/**
 * Transcricao literal da tabela de DATA-MODEL §3, item 2, na ordem em que
 * aparece la.
 *
 * **Uma raiz por nome.** `nature` pertence a categoria onde o lancamento cai, e
 * a raiz e agrupamento: "Alimentacao" e uma raiz essential com "Mercado"
 * essential e "Restaurantes"/"Delivery" non_essential. A raiz carrega `nature`
 * so para o caso de lancamento anexado direto nela. Nenhuma child tem child
 * (maximo 1 nivel).
 */
const CATEGORY_TREE: readonly RootSeed[] = [
  {
    name: 'Moradia',
    nature: 'essential',
    children: [
      { name: 'Aluguel/Financiamento', nature: 'essential' },
      { name: 'Condomínio', nature: 'essential' },
      { name: 'Luz', nature: 'essential' },
      { name: 'Água', nature: 'essential' },
      { name: 'Gás', nature: 'essential' },
      { name: 'Internet', nature: 'essential' },
    ],
  },
  {
    name: 'Alimentação',
    nature: 'essential',
    children: [
      { name: 'Mercado', nature: 'essential' },
      { name: 'Restaurantes', nature: 'non_essential' },
      { name: 'Delivery', nature: 'non_essential' },
    ],
  },
  {
    name: 'Transporte',
    nature: 'essential',
    children: [
      { name: 'Combustível', nature: 'essential' },
      { name: 'Transporte público', nature: 'essential' },
      { name: 'Aplicativos', nature: 'non_essential' },
      { name: 'Estacionamento', nature: 'non_essential' },
    ],
  },
  {
    name: 'Saúde',
    nature: 'essential',
    children: [
      { name: 'Plano', nature: 'essential' },
      { name: 'Farmácia', nature: 'essential' },
      { name: 'Consultas', nature: 'essential' },
    ],
  },
  {
    name: 'Educação',
    nature: 'essential',
    children: [
      { name: 'Escola', nature: 'essential' },
      { name: 'Cursos', nature: 'essential' },
    ],
  },
  { name: 'Impostos e taxas', nature: 'essential' },
  { name: 'Seguros', nature: 'essential' },
  {
    name: 'Lazer',
    nature: 'non_essential',
    children: [
      { name: 'Viagens', nature: 'non_essential' },
      { name: 'Streaming', nature: 'non_essential' },
      { name: 'Eventos', nature: 'non_essential' },
    ],
  },
  { name: 'Vestuário', nature: 'non_essential' },
  { name: 'Casa e decoração', nature: 'non_essential' },
  { name: 'Presentes', nature: 'non_essential' },
  { name: 'Cuidados pessoais', nature: 'non_essential' },
  { name: 'Assinaturas', nature: 'non_essential' },
  { name: 'Outros', nature: 'non_essential' },
  {
    name: 'Investimentos',
    nature: 'investment',
    children: [
      { name: 'Aportes', nature: 'investment' },
      { name: 'Reserva de emergência', nature: 'investment' },
    ],
  },
  {
    name: 'Receitas',
    nature: 'income',
    children: [
      { name: 'Salário', nature: 'income' },
      { name: 'Pró-labore', nature: 'income' },
      { name: 'Renda variável', nature: 'income' },
      { name: 'Aluguéis', nature: 'income' },
      { name: 'Reembolsos', nature: 'income' },
      { name: 'Outras receitas', nature: 'income' },
    ],
  },
];

/** Chave estavel de categoria: `categoria:Raiz` ou `categoria:Raiz/Filha`. */
function categoryId(root: string, child?: string): string {
  return uuidv5(`categoria:${child ? `${root}/${child}` : root}`);
}

type CategoryRow = typeof categories.$inferInsert;

function buildCategories(): CategoryRow[] {
  const rows: CategoryRow[] = [];
  let order = 0;

  for (const root of CATEGORY_TREE) {
    rows.push({
      id: categoryId(root.name),
      householdId: HOUSEHOLD_ID,
      name: root.name,
      parentId: null,
      nature: root.nature,
      sortOrder: order,
    });
    order += 1;

    for (const child of root.children ?? []) {
      rows.push({
        id: categoryId(root.name, child.name),
        householdId: HOUSEHOLD_ID,
        name: child.name,
        parentId: categoryId(root.name),
        nature: child.nature,
        sortOrder: order,
      });
      order += 1;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Regras de categorização — DATA-MODEL §3, item 3
// ---------------------------------------------------------------------------

/**
 * 22 regras para os comerciantes mais obvios (mercados, postos, streamings),
 * dentro da faixa de 15 a 25 de DATA-MODEL §3, item 3. Toda regra aponta para
 * uma **folha**, nunca para a raiz.
 *
 * `pattern` em maiusculas porque e assim que extrato e fatura escrevem a
 * descricao; a normalizacao antes do match e responsabilidade do motor de
 * regras, nao do dado.
 *
 * `priority`: menor = avaliado primeiro (DATA-MODEL §2). Padroes mais
 * especificos ganham prioridade menor que os genericos.
 */
type RuleSeed = {
  pattern: string;
  root: string;
  child?: string;
  priority?: number;
  matchType?: MatchType;
};

const RULES: readonly RuleSeed[] = [
  // Mercados
  { pattern: 'CARREFOUR', root: 'Alimentação', child: 'Mercado' },
  { pattern: 'PAO DE ACUCAR', root: 'Alimentação', child: 'Mercado' },
  { pattern: 'ASSAI', root: 'Alimentação', child: 'Mercado' },
  { pattern: 'ATACADAO', root: 'Alimentação', child: 'Mercado' },
  { pattern: 'EXTRA', root: 'Alimentação', child: 'Mercado' },
  { pattern: 'SONDA', root: 'Alimentação', child: 'Mercado' },

  // Delivery e restaurantes
  { pattern: 'IFOOD', root: 'Alimentação', child: 'Delivery' },
  { pattern: 'RAPPI', root: 'Alimentação', child: 'Delivery' },

  // Postos
  { pattern: 'IPIRANGA', root: 'Transporte', child: 'Combustível' },
  { pattern: 'POSTO SHELL', root: 'Transporte', child: 'Combustível' },
  { pattern: 'POSTO', root: 'Transporte', child: 'Combustível', priority: 200 },

  // Transporte por aplicativo — folha non_essential, separada do publico
  { pattern: 'UBER', root: 'Transporte', child: 'Aplicativos' },
  { pattern: '99APP', root: 'Transporte', child: 'Aplicativos' },
  { pattern: 'ESTAPAR', root: 'Transporte', child: 'Estacionamento' },

  // Streamings e assinaturas
  { pattern: 'NETFLIX', root: 'Lazer', child: 'Streaming' },
  { pattern: 'SPOTIFY', root: 'Lazer', child: 'Streaming' },
  { pattern: 'DISNEY', root: 'Lazer', child: 'Streaming' },
  { pattern: 'AMAZON PRIME', root: 'Lazer', child: 'Streaming' },

  // Farmácias
  { pattern: 'DROGASIL', root: 'Saúde', child: 'Farmácia' },
  { pattern: 'DROGA RAIA', root: 'Saúde', child: 'Farmácia' },
  { pattern: 'PACHECO', root: 'Saúde', child: 'Farmácia' },

  // Utilidades
  { pattern: 'VIVO', root: 'Moradia', child: 'Internet' },
];

type RuleRow = typeof categorizationRules.$inferInsert;

function buildRules(): RuleRow[] {
  return RULES.map((rule) => ({
    id: uuidv5(`rule:${rule.pattern}`),
    householdId: HOUSEHOLD_ID,
    pattern: rule.pattern,
    matchType: rule.matchType ?? 'contains',
    categoryId: categoryId(rule.root, rule.child),
    priority: rule.priority ?? 100,
  }));
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [emailA, emailB] = readAllowlist();
  const categoryRows = buildCategories();
  const ruleRows = buildRules();

  // Uma transacao: ou entra o seed inteiro, ou nada (CONVENTIONS §7).
  await db.transaction(async (tx) => {
    await tx
      .insert(households)
      .values({ id: HOUSEHOLD_ID, name: 'Casa' })
      .onConflictDoNothing();

    await tx
      .insert(members)
      .values([
        {
          id: uuidv5(`membro:${emailA}`),
          householdId: HOUSEHOLD_ID,
          name: emailA.split('@')[0] ?? 'Membro 1',
          email: emailA,
          color: MEMBER_COLORS[0],
        },
        {
          id: uuidv5(`membro:${emailB}`),
          householdId: HOUSEHOLD_ID,
          name: emailB.split('@')[0] ?? 'Membro 2',
          email: emailB,
          color: MEMBER_COLORS[1],
        },
      ])
      .onConflictDoNothing();

    // Sem colunas: os defaults de DATA-MODEL §2 ja sao os valores desejados.
    await tx
      .insert(householdSettings)
      .values({ householdId: HOUSEHOLD_ID })
      .onConflictDoNothing();

    // Raizes antes das children: `parent_id` referencia uma linha do mesmo lote.
    const roots = categoryRows.filter((c) => c.parentId === null);
    const children = categoryRows.filter((c) => c.parentId !== null);
    await tx.insert(categories).values(roots).onConflictDoNothing();
    await tx.insert(categories).values(children).onConflictDoNothing();

    await tx.insert(categorizationRules).values(ruleRows).onConflictDoNothing();
  });

  console.log(
    `Seed aplicado: 1 household, 2 members, 1 household_settings, ` +
      `${categoryRows.length} categorias, ${ruleRows.length} regras.`,
  );
  console.log('Rodar de novo nao duplica nada.');
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    console.error('Seed falhou:', error);
    await sql.end();
    process.exit(1);
  });
