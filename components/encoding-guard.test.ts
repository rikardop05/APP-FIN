import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guarda de codificação (impeccable harden): mojibake — UTF-8 gravado corretamente e depois RELIDO
 * como Latin-1/CP1252 — chegou a produção duas vezes (rodada do menu, commit 16b2001, e
 * lib/import/pdf, desde d04b3ba; ambos corrigidos). O padrão nunca é pt-BR legítimo: letra
 * acentuada de cabeça alta (de U+00C0 a U+00DC) ou a inicial dos caracteres de 3 bytes (o 'â'
 * minúsculo) seguida de pontuação de código (§ £ ª µ ¡ © ³ º ¢ NBSP € ‰ aspas tipográficas…). O teste varre as
 * fontes do app e falha listando arquivo e linha, para o erro morrer no gate e não na tela.
 */
const DIRS = ['app', 'components', 'lib'] as const;
const EXT = /\.(?:ts|tsx|md)$/;

/** U+00A0–U+00BF (NBSP…¿) e os pontos altos do CP1252 (€ ‚ ƒ „ … † ‡ ‰ ‹ › “ ” – — ™ œ …). */
const CP1252_HIGH =
  '\\u0080-\\u00BF\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039' +
  '\\u0152\\u017D\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A' +
  '\\u0153\\u017E\\u0178';
/** Letra acentuada em MAIÚSCULA (U+00C0 a U+00DC) ou a inicial mojibake dos 3 bytes (o 'â'). */
const MOJIBAKE_LEAD = '\\u00C0-\\u00DC\\u00E2';
const MOJIBAKE = new RegExp(`[${MOJIBAKE_LEAD}][${CP1252_HIGH}]`);

function walk(dir: string, root: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(path, root);
    return EXT.test(entry.name) ? [path] : [];
  });
}

describe('encoding: nenhum mojibake (UTF-8 relido como Latin-1/CP1252)', () => {
  it('em app/, components/ e lib/', () => {
    const root = process.cwd();
    const findings: string[] = [];
    for (const file of DIRS.flatMap((dir) => walk(dir, root))) {
      const lines = readFileSync(join(root, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (MOJIBAKE.test(line)) findings.push(`${file}:${index + 1}`);
      });
    }
    expect(findings).toEqual([]);
  });

  it('o padrão aponta mojibake e NÃO texto pt-BR legítimo', () => {
    // Â / Ã seguidos de letra continuam legítimos ("Ângulo", "Ãmbar"); só a pontuação de código denuncia.
    for (const legit of ['\u00C3ngulo', '\u00C2nsia', '\u00C2mbar', 'Resolu\u00E7\u00E3o', '\u00C3']) {
      expect(MOJIBAKE.test(legit), JSON.stringify(legit)).toBe(false);
    }
    for (const sample of [
      'Navega\u00C3\u00A7\u00E3o', // Ã + § ('Navegacção relida')
      'Mais op\u00C3\u00A7\u00F5es',
      'CONTRACTS \u00C2\u00A715', // Â + §
      'resolvi \u00E2\u20AC\u201D pronto', // â + € ('—' relido)
      '\u00E2\u20AC\u0153aspas\u201D', // â + € ('" ' relida)
      '\u00C2\u00A0', // Â + NBSP
      'caf\u00C3\u00A9',
    ]) {
      expect(MOJIBAKE.test(sample), JSON.stringify(sample)).toBe(true);
    }
  });
});
