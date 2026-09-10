import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/** Extensoes que a regra de camada vigia. `.tsx` inclusive, senao ela vaza. */
const LIB_GLOB = '**/*.{ts,tsx,mts,cts}';

/**
 * Camadas puras de CONVENTIONS §5. `lib/money` e `lib/date` entram junto: sao
 * primitivos puros, e o aceite do T-003 exige zero dependencia de `/lib/db` e
 * `next/*`.
 */
const PURE_DIRS = [
  `lib/finance/${LIB_GLOB}`,
  `lib/import/${LIB_GLOB}`,
  `lib/money/${LIB_GLOB}`,
  `lib/date/${LIB_GLOB}`,
];

/** Camadas puras que **nao** fazem conta de calendario (tudo menos lib/date). */
const PURE_DIRS_WITHOUT_DATE = [
  `lib/finance/${LIB_GLOB}`,
  `lib/import/${LIB_GLOB}`,
  `lib/money/${LIB_GLOB}`,
];

/**
 * CONVENTIONS §5: modulo puro nao alcanca banco, Next, fs nem rede — nem por
 * caminho que burla `no-restricted-imports` (import dinamico, require,
 * `globalThis.fetch`).
 */
const PURITY_SYNTAX = [
  {
    // import() dinamico burla no-restricted-imports. Barrado por alvo, nao em
    // bloco: import() de biblioteca permitida (pdfjs-dist) continua valido.
    selector: 'ImportExpression[source.value=/(^|\\/)(lib\\/)?db(\\/|$)/]',
    message:
      'CONVENTIONS §5: modulo puro nao alcanca /lib/db, nem por import dinamico.',
  },
  {
    selector: 'ImportExpression[source.value=/^next(\\/|$)/]',
    message:
      'CONVENTIONS §5: modulo puro nao importa next/*, nem por import dinamico.',
  },
  {
    selector: 'ImportExpression[source.value=/^(node:)?fs(\\/|$)/]',
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
    // require() tambem burla no-restricted-imports, pelo mesmo motivo.
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
];

const CLOCK_MESSAGE =
  'CONVENTIONS §4: /lib nao le o relogio. Receba a data como parametro (today: string) — e o que torna o teste deterministico.';

const CALENDAR_MESSAGE =
  'CONVENTIONS §4: aritmetica de calendario vive so em lib/date — chame lib/date em vez de usar Date aqui.';

/**
 * CONVENTIONS §4, primeira metade: **o proibido em /lib e ler o relogio.**
 * Vale em todo `/lib`, `lib/date` incluida.
 *
 * Nao basta olhar `new Date()` e `Date.now()`: o mesmo relogio se le por
 * varios caminhos, e todos precisam fechar.
 */
const CLOCK_SYNTAX = [
  {
    // `new Date()` sem argumento nenhum: le a hora corrente.
    selector: 'NewExpression[callee.name="Date"][arguments.length=0]',
    message: CLOCK_MESSAGE,
  },
  {
    // `Date()` **sem** new devolve a hora corrente como string.
    selector: 'CallExpression[callee.name="Date"]',
    message: CLOCK_MESSAGE,
  },
  {
    // `Date.now` referenciado, nao so chamado: pega `Date.now()` e tambem
    // `const n = Date.now` guardado para chamar depois. `call`/`apply`/`bind`
    // entram porque `Date.call(null)` tambem devolve a hora corrente.
    selector:
      'MemberExpression[object.name="Date"][property.name=/^(now|call|apply|bind)$/]',
    message: CLOCK_MESSAGE,
  },
  {
    // Acesso computado — `Date['now']()` — burla o seletor por nome.
    selector: 'MemberExpression[computed=true][object.name="Date"]',
    message:
      'CONVENTIONS §4: nao alcance membro de Date por indice — use a forma direta, senao a regra de data nao ve o uso.',
  },
  {
    // `Date` passado como valor: `Reflect.apply(Date, null, [])`, `f(Date)`.
    // Construir data nao precisa disso — `new Date(...)` e `Date.UTC(...)` nao
    // casam aqui, porque em nenhum dos dois `Date` e argumento.
    selector: 'CallExpression > Identifier[name="Date"]',
    message:
      'CONVENTIONS §4: nao passe Date como valor — use `new Date(...)` ou `Date.UTC(...)` direto.',
  },
  {
    // Outras fontes de relogio, pelo mesmo motivo de determinismo.
    selector:
      'MemberExpression[object.name="performance"][property.name="now"]',
    message: CLOCK_MESSAGE,
  },
  {
    selector: 'MemberExpression[object.name="process"][property.name="hrtime"]',
    message: CLOCK_MESSAGE,
  },
  {
    // Alcancar `Date` pelo objeto global burla os seletores por identificador.
    selector:
      'MemberExpression[object.name=/^(globalThis|window|self)$/][property.name="Date"]',
    message:
      'CONVENTIONS §4: alcance Date pelo identificador, nao pelo objeto global — e o que deixa a regra de data enxergar o uso.',
  },
  {
    // `const Clock = Date` e `const { now } = Date` escondem o uso da analise
    // estatica. Sem motivo legitimo para apelidar Date.
    selector: 'VariableDeclarator[init.name="Date"]',
    message:
      'CONVENTIONS §4: nao apelide Date — use o identificador direto, senao a regra de data nao ve o uso.',
  },
];

/**
 * CONVENTIONS §4, segunda metade: aritmetica de calendario vive **so** em
 * `lib/date`. Fora dela nem construir `Date` a partir de valor explicito —
 * `lib/finance` e `lib/import` chamam `lib/date`.
 *
 * Restringir o **global** `Date` (e nao enumerar formas de sintaxe) e o que
 * fecha de uma vez `new Date(...)`, `Date.UTC(...)`, `Date.parse(...)` e
 * qualquer apelido: a regra usa analise de escopo, entao so dispara quando
 * `Date` resolve para o global, e nao quando e uma variavel local homonima.
 */
const RESTRICTED_DATE_GLOBAL = {
  name: 'Date',
  message: CALENDAR_MESSAGE,
};

/** Globais que camada pura nao alcanca (CONVENTIONS §5). */
const PURE_GLOBALS = [
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
];

/**
 * `no-restricted-syntax` e `no-restricted-globals` sao **substituidas**, nao
 * somadas, quando dois blocos pegam o mesmo arquivo: vale a ultima. Por isso
 * cada bloco abaixo repassa a lista **completa** que quer naquele conjunto de
 * arquivos, em vez de contar com acumulo. Foi assim que a primeira versao deste
 * ajuste apagou sem aviso os seletores de pureza de `lib/finance`.
 *
 * Ordem dos blocos, do geral para o especifico:
 *   1. todo `/lib` .................. relogio + `Date` proibido
 *   2. `lib/date` ................... relogio + pureza, `Date` **liberado**
 *   3. camadas puras sem `lib/date` . relogio + pureza + `Date` proibido
 */
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
    // Pureza das camadas: imports, process.env e rede.
    files: PURE_DIRS,
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
      'no-restricted-globals': ['error', ...PURE_GLOBALS],
    },
  },
  {
    /**
     * Todo `/lib` — `lib/db`, `lib/auth` e `lib/utils.ts` inclusive: nao ler o
     * relogio e nao usar `Date`. `lib/date` recupera o `Date` no bloco
     * seguinte; aqui a proibicao e a regra geral.
     */
    files: [`lib/${LIB_GLOB}`],
    rules: {
      'no-restricted-syntax': ['error', ...CLOCK_SYNTAX],
      'no-restricted-globals': ['error', RESTRICTED_DATE_GLOBAL],
    },
  },
  {
    /**
     * `lib/date`: unico lugar do sistema com aritmetica de calendario, entao o
     * global `Date` volta a ser permitido — e so aqui. O relogio segue
     * proibido, pelos seletores de `CLOCK_SYNTAX`.
     */
    files: [`lib/date/${LIB_GLOB}`],
    rules: {
      'no-restricted-syntax': ['error', ...PURITY_SYNTAX, ...CLOCK_SYNTAX],
      'no-restricted-globals': ['error', ...PURE_GLOBALS],
    },
  },
  {
    // Demais camadas puras: pureza + relogio + `Date` proibido.
    files: PURE_DIRS_WITHOUT_DATE,
    rules: {
      'no-restricted-syntax': ['error', ...PURITY_SYNTAX, ...CLOCK_SYNTAX],
      'no-restricted-globals': [
        'error',
        ...PURE_GLOBALS,
        RESTRICTED_DATE_GLOBAL,
      ],
    },
  },
];

export default config;
