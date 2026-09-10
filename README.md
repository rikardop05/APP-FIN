# APPFIN

Controle financeiro domestico de um household com 2 membros. Web responsivo
(PWA), stack unica TypeScript: Next.js 15 App Router, PostgreSQL via Drizzle,
Auth.js com magic link.

A especificacao vive em [`docs/`](./docs) e e a fonte de verdade:

| Documento | Papel |
|-----------|-------|
| [`docs/SPEC.md`](./docs/SPEC.md) | requisitos e decisoes travadas |
| [`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md) | schema — fonte de verdade; divergencia com o codigo e bug do codigo |
| [`docs/CONTRACTS.md`](./docs/CONTRACTS.md) | assinaturas das funcoes de `lib/` |
| [`docs/CONVENTIONS.md`](./docs/CONVENTIONS.md) | regras inviolaveis — leitura obrigatoria antes de escrever codigo |
| [`docs/BUILD-PLAN.md`](./docs/BUILD-PLAN.md) | tarefas e posse de arquivo |
| [`docs/IMPORT-SOURCES.md`](./docs/IMPORT-SOURCES.md) | formato de cada banco suportado |

## Comecando

```bash
npm install
cp .env.example .env.local   # preencha os valores
npm run dev
```

O banco e as migrations chegam no T-002; ate lá `npm run dev` sobe a aplicacao
sem persistencia.

## Scripts

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de producao (falha em erro de tipo ou de lint) |
| `npm run start` | serve o build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, uma passada |
| `npm run test:watch` | Vitest em watch |

## Estrutura

```
app/(app)/        telas
app/api/          rotas HTTP — validam com Zod, chamam lib/, persistem
components/       UI reutilizavel
lib/money/        primitivos de dinheiro (centavos), puros
lib/date/         primitivos de data e competencia, puros
lib/finance/      motor de calculo, PURO
lib/import/       parsers de extrato e fatura, PUROS
lib/db/           schema Drizzle e queries — unico lugar com SQL
tests/            testes que nao pertencem a um modulo
```

Regra dura de camada: nada em `lib/finance` e `lib/import` importa `lib/db`,
`next/*`, `fs` ou le `process.env`. O ESLint recusa (CONVENTIONS §5).

## Convencoes que doem se ignoradas

- Dinheiro e **inteiro de centavos**, coluna com sufixo `_cents`. Float para
  dinheiro e proibido.
- Percentual e **inteiro em basis points**, sufixo `_bp`. `500 bp = 5,00 %`.
- Identificadores em ingles, texto de UI em pt-BR.
- Toda query filtra `household_id`.
- Arquivo real de fatura ou extrato mora em `.private/` (ignorado pelo git).
  Fixture de teste e sempre anonimizada.
