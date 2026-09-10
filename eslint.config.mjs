import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // CONVENTIONS §6: `any` e proibido.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // CONVENTIONS §5: /lib/finance e /lib/import sao puros — nao importam
    // banco, Next, fs, rede, nem leem process.env.
    // /lib/money e /lib/date entram na mesma regra: sao primitivos puros e o
    // aceite do T-003 exige zero dependencia de /lib/db e next/*.
    files: [
      'lib/finance/**/*.{ts,tsx,mts,cts}',
      'lib/import/**/*.{ts,tsx,mts,cts}',
      'lib/money/**/*.{ts,tsx,mts,cts}',
      'lib/date/**/*.{ts,tsx,mts,cts}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            // lib/db pelo alias e por qualquer caminho relativo.
            '@/lib/db',
            '@/lib/db/*',
            '**/lib/db',
            '**/lib/db/*',
            '**/db',
            '**/db/*',
            'next',
            'next/*',
            'fs',
            'node:fs',
            'fs/promises',
            'node:fs/promises',
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'CONVENTIONS §5: modulo puro nao le process.env — receba o valor como parametro.',
        },
        {
          object: 'globalThis',
          property: 'fetch',
          message:
            'CONVENTIONS §5: modulo puro nao faz I/O — receba os dados como parametro.',
        },
        {
          object: 'globalThis',
          property: 'process',
          message:
            'CONVENTIONS §5: modulo puro nao le o ambiente — receba o valor como parametro.',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'CONVENTIONS §5: modulo puro nao faz I/O — receba os dados como parametro.',
        },
        {
          name: 'process',
          message:
            'CONVENTIONS §5: modulo puro nao le o ambiente — receba o valor como parametro.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // import() dinamico burla no-restricted-imports. Barrado por alvo,
          // nao em bloco: import() de biblioteca permitida (pdfjs-dist, por
          // exemplo) continua valido.
          selector:
            'ImportExpression[source.value=/(^|\\/)(lib\\/)?db(\\/|$)/]',
          message:
            'CONVENTIONS §5: modulo puro nao alcanca /lib/db, nem por import dinamico.',
        },
        {
          selector: 'ImportExpression[source.value=/^next(\\/|$)/]',
          message:
            'CONVENTIONS §5: modulo puro nao importa next/*, nem por import dinamico.',
        },
        {
          selector:
            'ImportExpression[source.value=/^(node:)?fs(\\/|$)/]',
          message:
            'CONVENTIONS §5: modulo puro nao faz I/O — receba os dados como parametro.',
        },
        {
          // import() com alvo calculado nao e auditavel estaticamente.
          selector: 'ImportExpression:not([source.type="Literal"])',
          message:
            'CONVENTIONS §5: import dinamico com alvo calculado nao e auditavel — use um literal.',
        },
        {
          // require() tambem burla no-restricted-imports. Barrado por alvo,
          // pelo mesmo motivo do import() acima.
          selector:
            'CallExpression[callee.name="require"][arguments.0.value=/(^|\\/)(lib\\/)?db(\\/|$)|^next(\\/|$)|^(node:)?fs(\\/|$)/]',
          message:
            'CONVENTIONS §5: modulo puro nao alcanca /lib/db, next/* nem fs, nem por require.',
        },
        {
          // Alcanca globalThis.fetch, window.fetch e afins.
          selector: 'MemberExpression[property.name="fetch"]',
          message:
            'CONVENTIONS §5: modulo puro nao faz I/O — receba os dados como parametro.',
        },
        {
          selector: 'NewExpression[callee.name="Date"]',
          message:
            'CONVENTIONS §4: funcao pura recebe a data como parametro (today: string) — new Date() quebra o determinismo do teste.',
        },
      ],
    },
  },
];

export default config;
