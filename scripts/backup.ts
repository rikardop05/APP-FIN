import { writeFileSync } from 'node:fs';

import { sql } from '../lib/db/index.ts';
import { exportHousehold } from '../lib/db/queries/backup.ts';

/**
 * Exporta UM household para um arquivo JSON (`appfin-backup`, v1), para cron ou uso manual.
 * Só leitura. NÃO restaura: restauração só pela API, com as guardas (household vazio,
 * validação inteira, transação).
 *
 * Uso: node --env-file-if-exists=.env.local scripts/backup.ts <householdId> [arquivo.json]
 */

async function main(): Promise<void> {
  const [householdId, outFile] = process.argv.slice(2);
  if (householdId === undefined || !/^[0-9a-f-]{36}$/i.test(householdId)) {
    console.error('Uso: node --env-file-if-exists=.env.local scripts/backup.ts <householdId> [arquivo.json]');
    process.exitCode = 2;
    return;
  }
  const exportedAt = new Date().toISOString();
  const backup = await exportHousehold(householdId, exportedAt);
  const target = outFile ?? `appfin-backup-${householdId}-${exportedAt.slice(0, 10)}.json`;
  writeFileSync(target, `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
  const total = Object.values(backup.tables).reduce((sum, rows) => sum + rows.length, 0);
  console.log(`Backup gravado em ${target}: ${String(total)} linhas em ${String(Object.keys(backup.tables).length)} tabelas.`);
}

main()
  .then(async () => {
    await sql.end();
  })
  .catch(async (error: unknown) => {
    console.error('Backup falhou:', error instanceof Error ? error.message : error);
    await sql.end();
    process.exit(1);
  });
