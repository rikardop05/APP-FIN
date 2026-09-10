# BUILD-PLAN — tarefas delegáveis

> Uma linha = uma unidade de delegação para um agente. **Posse de arquivo é exclusiva:** um agente só escreve nos caminhos listados em "Posse". Dois agentes nunca possuem o mesmo arquivo — é o que permite rodar em paralelo sem conflito.
> "⛔ Gate" = ponto de revisão humana; o orquestrador para e reporta antes de seguir.
> **`package.json` e `package-lock.json` são posse serial compartilhada** (ORCHESTRATION §4.1): qualquer tarefa pode acrescentar as dependências que a **sua própria linha** declara, uma tarefa por vez, nunca em janela paralela. Não é preciso listar o manifesto na posse de cada tarefa.
> Legenda de tipo: **P** = puro (`/lib`, alta densidade de teste) · **D** = dados/schema · **A** = API/persistência · **U** = UI/tela · **I** = infra.

---

## Fase 0 — Fundação (serial, sem paralelismo)

### T-001 · Bootstrap do projeto · I
**Depende de:** —
**Posse:** `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `eslint.config.mjs`, `components.json`, `lib/utils.ts`, `.env.example`, `.gitignore`, `README.md`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `tests/**`, e os `.gitkeep` da estrutura de pastas
> Posse ratificada em 2026-09-10, no gate: `components.json` e `lib/utils.ts` são exigência do `shadcn init`, `package-lock.json` é saída do `npm install`, `tests/` recebe o teste trivial que o aceite pede. Nenhuma outra tarefa possui esses caminhos. `app/page.tsx` foi concedido em 2026-09-10 para uma landing mínima de conferência visual no gate; o T-005 a substitui pelo shell real.
**Entrega:** `git init` + `.gitignore` (pré-requisito: a validação de posse de arquivo de ORCHESTRATION §7 depende de `git status`/`diff`). Next.js 15 App Router + TypeScript `strict` + Tailwind + shadcn/ui inicializado + Vitest + ESLint. Estrutura de pastas vazia conforme CONVENTIONS §5. `.env.example` com todas as variáveis nomeadas (sem valores). **Não commitar:** o commit inicial é decisão do humano.
**Aceite:** `npm run build`, `npm run lint` e `npm test` passam (teste trivial). Nenhum arquivo fora da posse.
**⛔ Gate** — o humano confere a stack instalada antes de qualquer outra tarefa.

### T-002 · Schema, migrations e seed · D
**Depende de:** T-001
**Posse:** `lib/db/schema.ts`, `lib/db/index.ts`, `lib/db/enums.ts`, `drizzle.config.ts`, `drizzle/**`, `scripts/seed.ts`
**Entrega:** DATA-MODEL.md traduzido para Drizzle, **integralmente** — todas as tabelas, enums, constraints, índices únicos e checks. Migration inicial gerada. Seed da §3 (household, 2 members, settings, árvore de categorias, 15–25 regras iniciais).
**Dependência de ambiente (constatada em 2026-09-10):** esta máquina não tem Postgres local, nem Docker, nem `DATABASE_URL` preenchida. O T-002 fica dividido em duas partes:

**2a — offline, verificável agora**
`lib/db/schema.ts` completo conforme DATA-MODEL (todas as tabelas, enums, checks, uniques, índices), `drizzle.config.ts`, migration **gerada** por `drizzle-kit generate` (não exige banco), SQL gerado revisado linha a linha contra DATA-MODEL, `scripts/seed.ts` escrito, scripts npm (`db:generate`, `db:migrate`, `db:seed`).
**Aceite 2a:** typecheck, lint e test verdes; o SQL da migration contém todos os enums, os **quatro** checks (conta-xor-cartão, `installment_number`, `one_off_competence`, `import_mappings.format`), o unique parcial de `dedupe_hash`, o **unique parcial de raiz de categoria** (`where parent_id is null`) e os índices declarados; nenhuma coluna de DATA-MODEL faltando.

**2b — exige banco provisionado pelo humano**
`DATABASE_URL` de um Postgres (Neon ou Supabase, free tier) no `.env`.
**Aceite 2b:** migration aplica em banco limpo; seed roda **duas vezes** sem duplicar; insert violando o check de conta/cartão é rejeitado pelo banco.

**⛔ Gate** — schema é a base de tudo; erro aqui contamina as quatro fases. O gate humano acontece ao fim de **2a**, sobre o SQL gerado, sem esperar o banco.

### T-003 · Primitivos de dinheiro e data · P
**Depende de:** T-001
**Posse:** `lib/money/**`, `lib/date/**`
**Entrega:** CONTRACTS §1 e §2, completos.
**Aceite:** `allocate(10000, 3)` soma exatamente 10000; `parseBRL` cobre `"1.234,56"`, `"1234.56"`, `"-R$ 10,00"`, `"R$ 0,00"`, lixo → null; `clampDayToMonth` cobre 31/fev em ano comum e bissexto; `addCompetence` cruza virada de ano nos dois sentidos. Zero dependência de `/lib/db` ou `next/*`.
**Paralelo com:** T-004

### T-004 · Autenticação · I
**Depende de:** T-002
**Posse:** `lib/auth/**`, `app/(auth)/**`, `middleware.ts`, `app/api/auth/**`
**Entrega:** Auth.js com magic link por e-mail, allowlist de 2 endereços vinda de env, sessão em cookie, middleware bloqueando toda rota fora de `/login`. Resolução de `household_id` e `member_id` da sessão em um helper único.
**Aceite:** e-mail fora da allowlist é recusado; rota protegida sem sessão redireciona para `/login`; helper de sessão devolve `householdId` e `memberId`.
**Paralelo com:** T-003

### T-005 · Layout, navegação e formatação · U
**Depende de:** T-001, T-003
**Posse:** `app/(app)/layout.tsx`, `components/nav/**`, `components/ui-kit/**` (Money, DateText, PageHeader, EmptyState, DataTable base), `lib/i18n/format.ts`
**Entrega:** shell responsivo (nav lateral no desktop, inferior no celular) com as 9 rotas de SPEC §7 como stubs; componentes de exibição de valor e data usando `formatBRL`/`formatDateBR`; tabela base com ordenação e paginação.
**Aceite:** legível e navegável em 390 px; nenhum valor monetário formatado fora de `<Money>`; rotas stub respondem 200.
**Depende de T-004 para navegar autenticado, mas pode ser escrita em paralelo.**

---

## Fase 0.5 — Levantamento de formatos (encerrado em parte)

### T-100 · Inventário de formatos por banco · I
**Depende de:** —
**Posse:** `docs/IMPORT-SOURCES.md`, `lib/import/__fixtures__/**`
**Achado do humano (2026-09-09):** **nenhum dos três bancos oferece OFX.** Isso encerra a busca pelo formato mais confiável e move o OFX para a Fase 4.
**O que resta:** confirmar se Nubank, Santander e Mercado Pago oferecem **CSV ou XLS/XLSX** (para a Fase 4, T-105/T-118) e guardar um exemplo anonimizado de cada formato disponível, inclusive dos PDFs, em `lib/import/__fixtures__/`.
**Aceite:** tabela §1 de `IMPORT-SOURCES.md` fechada, com o formato e o canal de cada banco.
**Não é gate.** A v1 entrega PDF + texto colado, que dependem do arquivo em mão e não deste levantamento.

---

## Fase 1 — Cartões, importação e comprometimento

Bloco paralelo A (só depende de T-003) — **4 agentes simultâneos:**

### T-101 · Motor de faturas · P
**Depende de:** T-003 · **Posse:** `lib/finance/billing.ts`, `lib/finance/billing.test.ts`
**Entrega:** CONTRACTS §3.
**Aceite:** compra no dia do fechamento cai na fatura corrente; um dia depois, na seguinte; `closing_day = 31` em fevereiro usa o último dia; `due_day <= closing_day` joga o vencimento para o mês seguinte; `reconcileStatement` detecta divergência de 1 centavo.

### T-102 · Parcelas · P
**Depende de:** T-003 · **Posse:** `lib/finance/installments.ts` + teste
**Entrega:** CONTRACTS §4.
**Aceite:** R$ 100,00 em 3x gera 33,34 / 33,33 / 33,33 somando 100,00; 10x gera 10 competências consecutivas cruzando virada de ano; `replanInstallments` preserva as realizadas.

### T-103 · Dedupe e normalização · P
**Depende de:** T-003 · **Posse:** `lib/finance/dedupe.ts` + teste
**Entrega:** CONTRACTS §7.
**Aceite:** mesma transação com sufixo de parcela diferente gera hash diferente; acento, caixa e espaço duplo não alteram o hash; duas compras idênticas no mesmo dia colidem (comportamento esperado, tratado na UI).

### T-104 · Categorização por regras · P
**Depende de:** T-003 · **Posse:** `lib/finance/categorization.ts` + teste
**Entrega:** CONTRACTS §6.
**Aceite:** ordem por `priority` respeitada; regex inválida é ignorada sem lançar; `suggestRulePattern` limpa dígitos, datas e sufixo de parcela de uma descrição real de cartão.

### T-121 · Detector de parcelas · P
**Depende de:** T-003 · **Posse:** `lib/import/installments.ts` + teste
**Entrega:** CONTRACTS §15 (`detectInstallment`).
**Aceite:** reconhece `PARC 03/10`, `03/10`, `PARCELA 3 DE 10` e `(3 de 10)`; devolve descrição limpa sem o sufixo; não confunde data (`03/10` de outubro) com parcela — caso de borda obrigatório no teste; devolve `null` quando não há padrão.
**Paralelo com:** T-101…T-104
> Extraída do T-106 (OFX) quando o OFX foi adiado: o detector é consumido pelo parser de PDF, pelo de texto colado e pelo pipeline, então não pode morar num parser adiado.

Bloco paralelo B (importação) — **T-120, depois T-117 + T-119 em paralelo, depois T-117b + T-117c em paralelo:**

### T-120 · Tipos e detecção de origem · P · **pré-requisito de todo parser**
**Depende de:** T-003 · **Posse:** `lib/import/types.ts`, `lib/import/detect.ts` + teste
**Entrega:** CONTRACTS §15, parte de tipos: `ParsedRow`, `ParseResult`, `ParseDiagnostic`, e `detectSource` (identifica formato e origem por extensão + assinatura de conteúdo).
**Aceite:** `detectSource` reconhece OFX por assinatura e PDF por header `%PDF`; devolve `format: 'unsupported'` para `.csv` e `.xlsx` (com a mensagem que orienta o caminho de texto colado) e `null` para desconhecido, sem lançar; os tipos compõem com `Cents`/`IsoDate` de T-003.
**Fora do escopo desta tarefa:** `ColumnMap` e `ImportMapping` — pertencem a T-105 (Fase 4). Não declarar tipo sem consumidor na v1.
> Esta tarefa existe porque CSV e XLSX saíram da Fase 1: os tipos compartilhados precisam de dono próprio, senão OFX, PDF e texto colado ficariam sem contrato comum.

### T-117 · Extração de PDF (infra comum) + parser Nubank · P · **caminho principal da v1**
**Depende de:** T-120, T-121 · **Posse:** `lib/import/pdf/extract.ts`, `lib/import/pdf/rows.ts`, `lib/import/pdf/nubank.ts`, `lib/import/pdf/detect.ts` + fixtures
**Entrega:** CONTRACTS §15, bloco de PDF:
1. `extractPdfTextItems` sobre **`pdfjs-dist`**, com coordenadas por run, decifragem por senha (RF-IMP-11) e decodificação sempre pelo `ToUnicode` do arquivo. **Proibido** extrator artesanal e **proibido** offset de glifo chumbado.
2. `groupIntoRows` — **RF-IMP-12**, remontagem de linha por coordenada. Infra comum aos três bancos, não código por banco.
3. `parseNubankPdf` + `detectPdfIssuer`.
**Aceite:** soma das linhas extraídas = total impresso na fatura Nubank, em 3 faturas de meses diferentes; `groupIntoRows` reconstrói linhas de data+descrição+valor a partir de runs separados (caso real do Santander: 884 runs, 1 com tudo junto); PDF cifrado sem senha lança `PdfPasswordError` e **não** é confundido com "sem camada de texto"; nenhuma linha de cabeçalho/rodapé virando lançamento; fixtures **anonimizadas**.
> Sonda já executada (`IMPORT-SOURCES.md` §2): os três bancos têm camada de texto. Não há mais decisão pendente sobre viabilidade.

### T-117b · Parser de PDF do Santander · P
**Depende de:** T-117 · **Posse:** `lib/import/pdf/santander.ts` + fixtures
**Entrega:** `parseSantanderPdf`. Fatura **cifrada com RC4** e **layout em colunas**: depende inteiramente do `groupIntoRows`.
**Aceite:** soma das transações = total da fatura, em 2 faturas; parcelas reconhecidas via T-121; blocos de propaganda e "parcele sua fatura" ignorados; abre com senha e com cópia decifrada.
**Paralelo com:** T-117c

### T-117c · Parser de PDF do Mercado Pago · P
**Depende de:** T-117 · **Posse:** `lib/import/pdf/mercadopago.ts` + fixtures
**Entrega:** `parseMercadoPagoPdf`. Fatura **cifrada com AES-256** e texto em **strings hexadecimais com fonte CID** (7 CMaps `ToUnicode`): valida que a decodificação de CID do T-117 funciona de ponta a ponta.
**Aceite:** soma das transações = total da fatura, em 2 faturas; acentuação correta após decodificação CID (teste explícito: descrição com ç/ã conferida caractere a caractere); parcelas reconhecidas; imagens/logos ignorados.

### T-119 · Parser de texto colado · P · **fallback universal**
**Depende de:** T-003, T-120 · **Posse:** `lib/import/text.ts` + teste
**Entrega:** CONTRACTS §15 (`parsePastedText`). Heurística por linha: token de data (`dd/mm`, `dd/mm/aaaa`, `dd mmm`, `aaaa-mm-dd`), token de valor (o último da linha), descrição no que resta. Cada linha recebe `confidence` e `sourceLine`.
**Aceite:** **nenhuma linha é descartada em silêncio** — linha sem data ou sem valor volta com `confidence: 'low'` e `missing` preenchido; texto do dump de um PDF real (com cabeçalho, rodapé e quebra de coluna) rende as transações corretas e marca o ruído como baixa confiança; data sem ano usa `defaultCompetence`; valor com `R$`, ponto de milhar e sinal invertido tratados.
> Com o CSV adiado, este é o caminho que cobre Santander e Mercado Pago na Fase 1. Prioridade alta.

> **Adiado para a Fase 4:** parser de CSV (T-105), parser de XLS/XLSX (T-118), **parser de OFX (T-106)**, toda a maquinaria de mapeamento de coluna (`ColumnMap`, `ImportMapping`, `import_mappings`) e os mapeamentos por banco (T-105a/b/c). Ver o bloco da Fase 4 e `IMPORT-SOURCES.md` §3.
>
> A v1 fica com **dois caminhos de entrada**: **PDF** (os três bancos, confirmados pela sonda) e **texto colado** como rede de segurança. Nenhum dos três bancos oferece OFX.

Bloco serial C (integração):

### T-107 · Pipeline de preview de importação · P
**Depende de:** T-101, T-103, T-104, T-120, T-121, T-117, T-117b, T-117c, T-119 · **Posse:** `lib/import/pipeline.ts` + teste
**Entrega:** CONTRACTS §15 (`buildImportPreview`) e §16 (`finalizeImport`) — orquestra parse + competência + dedupe + categorização + detecção de parcela, e converte as linhas **confirmadas** no que será gravado, recalculando competência e hash após edição (RF-IMP-09).
**Aceite:** um arquivo com 1 duplicata, 1 parcelada em 10x e 3 linhas novas produz o `summary` exato esperado; as invariantes de CONTRACTS §16 valem (editar data muda competência e hash; editar valor muda hash e total; excluir linha a move para `skipped`); roda sem tocar banco.

### T-108 · Persistência da importação · A
**Depende de:** T-002, T-004, T-107 · **Posse:** `app/api/import/**`, `lib/db/queries/import.ts`, `lib/db/queries/transactions.ts`
**Entrega:** rotas de upload (parse + preview, sem gravar), commit (transação única: `import_batch` + `statements` + `installment_plans` + `transactions`) e revert (apaga o lote inteiro). Validação Zod no corpo.
**Aceite:** subir o mesmo arquivo duas vezes não duplica lançamento; falha no meio do commit não deixa registro parcial; revert remove exatamente as linhas do lote; toda query filtra `household_id`.

### T-109 · Contas e cartões (CRUD + tela) · U
**Depende de:** T-002, T-005 · **Posse:** `app/(app)/cartoes/**`, `app/api/cards/**`, `app/api/accounts/**`, `lib/db/queries/cards.ts`
**Entrega:** cadastro de contas e cartões com dia de fechamento/vencimento, lista de faturas por cartão com status e divergência de conciliação.
**Aceite:** criar cartão com `closing_day` 1–31 validado; fatura mostra total calculado vs informado e sinaliza divergência.
**Paralelo com:** T-108

### T-110 · Comprometimento futuro · P
**Depende de:** T-101 · **Posse:** `lib/finance/commitment.ts` + teste
**Entrega:** CONTRACTS §5.
**Aceite:** 3 planos de parcela em cartões diferentes agregam corretamente por competência; `lastCommittedCompetence` aponta o último mês com parcela; `usageBp` null quando o cartão não tem limite cadastrado.
**Paralelo com:** T-108, T-109

### T-111 · Tela de importação e confirmação · U · **a tela mais importante da Fase 1**
**Depende de:** T-108, T-005 · **Posse:** `app/(app)/importar/**`, `components/import/**`
**Entrega:**
1. **Card de arquivo** — upload de **PDF**, com seleção de cartão/conta, competência e **campo de senha** que aparece quando o arquivo é detectado como cifrado (RF-IMP-11: senha só em memória, nunca persistida nem logada). `.ofx`, `.csv`, `.xls` e `.xlsx` são reconhecidos e recusados com mensagem orientando o card de texto colado (todos são Fase 4).
2. **Card de texto colado** — área de texto dedicada (RF-IMP-07), para colar linhas de qualquer origem.
3. **Tela de confirmação** — obrigatória nos dois caminhos, com **edição linha a linha de data, valor, descrição, parcelamento (atual/total), categoria e responsável**, marcar/desmarcar como parcelada, e incluir/excluir a linha. Estado por linha (nova | duplicada | parcelada) e nível de confiança nas origens PDF e texto. Rodapé com total do lote vs total informado.
4. **Histórico de lotes** com desfazer, e aviso de arquivo já importado (RF-IMP-10).
**Aceite:** fluxo completo em < 2 min com um arquivo real de 60 linhas; PDF cifrado pede senha e abre com ela, e senha errada mostra erro claro sem vazar o valor digitado; **nada é gravado antes de confirmar**; editar a data de uma linha muda a competência exibida na hora; editar valor atualiza o total do rodapé; linha de baixa confiança vem destacada com o texto original visível; duplicadas excluídas por default com opção de forçar; desfazer funciona pela UI; legível em 390 px.

### T-112 · Tela de lançamentos · U
**Depende de:** T-002, T-005, T-104 · **Posse:** `app/(app)/lancamentos/**`, `app/api/transactions/**`, `components/transactions/**`
**Entrega:** tabela filtrável (período, categoria, cartão/conta, membro, texto, "não categorizados"), edição inline, categorização em lote, criação de "regra a partir deste lançamento", lançamento manual.
**Aceite:** filtro por não categorizados; selecionar 10 linhas e categorizar de uma vez; criar regra a partir de um lançamento e ver a sugestão de padrão preenchida.
**Paralelo com:** T-111

### T-113 · Comprometimento futuro na tela de cartões · U
**Depende de:** T-110, T-109 · **Posse:** `components/cards/commitment/**` (+ ponto de montagem já previsto por T-109)
**Entrega:** tabela de 24 meses, gráfico de barras, destaque do mês em que zera, uso de limite por cartão.
**Aceite:** legível em 390 px; números batem com `futureCommitment`.

### T-114 · Categorias e regras em /config · U
**Depende de:** T-002, T-005, T-104 · **Posse:** `app/(app)/config/**`, `app/api/categories/**`, `app/api/rules/**`
**Entrega:** CRUD de categorias (2 níveis, `nature`), CRUD e reordenação de regras, contador de `hits`, membros e premissas globais.
**Aceite:** impedir criar categoria de 3º nível; alterar prioridade de regra reflete na próxima categorização.
**Paralelo com:** T-113

### T-115 · Dashboard Fase 1 · U
**Depende de:** T-112, T-110 · **Posse:** `app/(app)/page.tsx`, `components/dashboard/**`, `lib/finance/kpis.ts` + teste
**Entrega:** CONTRACTS §14 + KPIs de receita/despesa/sobra, gastos por categoria do mês, comprometimento futuro resumido, fila de pendências (não categorizados, faturas divergentes).
**Aceite:** RC-03/RC-04 respeitados (transferência e pagamento de fatura fora da despesa; aporte separado); carrega em < 1,5 s com 5 mil lançamentos; legível em 390 px.

### T-116 · Aceite de ponta a ponta da Fase 1 · I
**Depende de:** T-111 … T-115 · **Posse:** `e2e/**`, `docs/ACCEPTANCE-F1.md`
**Entrega:** roteiro executado com arquivo real de um cartão, cobrindo os 8 critérios de SPEC §12.
**⛔ Gate** — Fase 2 não começa sem este aceite.

---

## Fase 2 — Orçamento e fluxo de caixa

### T-201 · Motor de recorrência · P
**Depende de:** T-003 · **Posse:** `lib/finance/recurrence.ts` + teste
**Aceite:** CONTRACTS §8; dia 31 em meses curtos; reajuste anual aplicado no aniversário; `one_off` gera exatamente uma ocorrência; `ends_on` respeitado.

### T-202 · Conciliação previsto × realizado · P
**Depende de:** T-003 · **Posse:** `lib/finance/reconcile.ts` + teste · **Paralelo com:** T-201
**Aceite:** CONTRACTS §9; sem reuso de par; tolerância de valor e janela de data respeitadas; melhor par escolhido quando há dois candidatos.

### T-203 · Motor de orçamento · P
**Depende de:** T-003 · **Posse:** `lib/finance/budget.ts` + teste · **Paralelo com:** T-201, T-202
**Aceite:** CONTRACTS §10; semáforo nos limites exatos (79,99/80,00/100,00/100,01 %); `plannedCents = 0` não gera divisão por zero.

### T-204 · Despesas fixas e receitas (CRUD + telas) · U
**Depende de:** T-002, T-005, T-201 · **Posse:** `app/(app)/orcamento/recorrentes/**`, `app/api/recurring/**`, `app/api/incomes/**`, `lib/db/queries/recurring.ts`
**Aceite:** cadastrar despesa mensal e receita de salário; ver as 12 ocorrências previstas geradas; `one_off` para 13º.

### T-205 · Orçamento por categoria · U
**Depende de:** T-203, T-005 · **Posse:** `app/(app)/orcamento/page.tsx`, `app/api/budgets/**` · **Paralelo com:** T-204
**Aceite:** "repetir mês anterior" e "média de 3 meses" preenchem os valores; semáforo correto; realizado vem das transações do mês.

### T-206 · Projeção de fluxo de caixa · P
**Depende de:** T-201 · **Posse:** `lib/finance/cashflow.ts` + teste
**Aceite:** CONTRACTS §11; saldo de abertura encadeia com o fechamento anterior; `firstNegativeCompetence` correto; `adjustments` do modo "e se" aplicados sem persistir.

### T-207 · Tela de fluxo · U
**Depende de:** T-206, T-005 · **Posse:** `app/(app)/fluxo/**`, `components/cashflow/**`
**Aceite:** linha de 12 meses com meses negativos em vermelho; tabela mês a mês com as parcelas do total; simulador "e se" altera a curva sem salvar.

### T-208 · Dashboard completo · U
**Depende de:** T-115, T-203, T-206 · **Posse:** `components/dashboard/**` (extensão)
**Aceite:** os 6 KPIs de SPEC §5.8 e os 4 primeiros gráficos; pendências incluindo orçamento estourado e recorrente não realizada.
**⛔ Gate** — fim da Fase 2.

---

## Fase 3 — Renda passiva e metas

### T-301 · Motor de investimento · P — **a tarefa mais sensível do projeto**
**Depende de:** T-003 · **Posse:** `lib/finance/investment.ts` + teste
**Entrega:** CONTRACTS §12, as 6 fórmulas de SPEC §5.6.
**Aceite:** cada fórmula com teste de valor conferido à mão (a conta no comentário); `monthlyRate` usa raiz 12 e nunca `/12`; `i = 0` tratado; meta inalcançável devolve `null` e não `NaN`/`Infinity`; `requiredContribution` devolve 0 quando o patrimônio atual já basta; `targetPortfolio` com `withdrawalBp = 0` não divide por zero. **Nenhum teste com valor "esperado" copiado da saída da própria implementação.**
**⛔ Gate** — o humano confere a tabela de cenários contra uma planilha antes de a tela ser construída.

### T-302 · Plano e cenários (CRUD) · A
**Depende de:** T-002, T-301 · **Posse:** `app/api/investment/**`, `lib/db/queries/investment.ts`
**Aceite:** criar plano cria os 3 cenários com os defaults de DATA-MODEL; premissas editáveis persistem.

### T-303 · Tela do planejador · U
**Depende de:** T-302, T-005
**Posse:** `app/(app)/investimentos/**`, `components/investment/**`
**Entrega:** entradas (renda desejada, patrimônio, aporte, prazo), tabela dos 3 cenários, aporte necessário por horizonte (5/10/15/20 anos), curvas de acumulação, premissas visíveis e editáveis ao lado do resultado.
**Aceite:** RF-INV-01 a 03 na tela (rótulo "valores em R$ de hoje", premissas visíveis, aviso de que retorno passado não é garantia); legível em 390 px; cenário inalcançável exibe mensagem, nunca `NaN`.

### T-304 · Ligação com a sobra real · U
**Depende de:** T-303, T-206 · **Posse:** `components/investment/feasibility/**`
**Entrega:** `contributionFeasibility` na tela: compara o aporte necessário com a sobra média real dos últimos 3 meses e sinaliza a lacuna (RF-INV-05).
**Aceite:** com sobra menor que o aporte necessário, exibe a lacuna em R$ e o alerta.

### T-305 · Metas e reserva de emergência · U
**Depende de:** T-002, T-005 · **Posse:** `app/(app)/metas/**`, `app/api/goals/**`, `lib/finance/goals.ts` + teste · **Paralelo com:** T-303
**Aceite:** CONTRACTS §13; reserva calcula alvo por `N × média de despesa essencial`; meta com data mostra aporte mensal necessário; progresso ordenado por prioridade.

### T-306 · Card de renda passiva no dashboard · U
**Depende de:** T-303, T-115 · **Posse:** `components/dashboard/passive-income/**`
**Aceite:** patrimônio atual vs alvo com as 3 curvas de cenário.
**⛔ Gate** — fim da Fase 3.

---

## Fase 4 — Refinos (sem ordem obrigatória, todos paralelizáveis)

| ID | Tarefa | Tipo | Depende | Posse |
|----|--------|------|---------|-------|
| T-401 | Mapeador manual de colunas, salvo por banco (`import_mappings`) | U+A | T-111, T-105 | `components/import/mapper/**`, `app/api/import/mappings/**` |
| T-402 | Exportação completa (JSON+CSV) e restauração de backup | A | T-002 | `app/api/backup/**`, `scripts/backup.ts` |
| T-403 | PWA: manifest, ícones, cache de leitura offline | I | T-005 | `public/manifest.json`, `public/icons/**`, `app/sw.ts` |
| T-404 | Posições reais de investimento (aporte efetivo vs planejado) | D+U | T-303 | nova tabela + `app/(app)/investimentos/posicoes/**` |
| T-405 | Alertas por e-mail (fatura a vencer, orçamento estourado) | I | T-208 | `app/api/cron/**` |
| **T-106** | **Parser de OFX** — adiado: nenhum dos três bancos oferece OFX hoje | P | T-120, T-121 | `lib/import/ofx.ts` + fixtures `.ofx` |
| **T-105** | **Parser de CSV** + `ColumnMap`/`ImportMapping` — adiado da Fase 1 | P | T-100, T-120 | `lib/import/csv.ts`, tipos de mapeamento + fixtures `.csv` |
| **T-118** | **Parser de XLS/XLSX** — adiado da Fase 1 (mesma maquinaria de mapeamento do CSV) | P | T-105 | `lib/import/xlsx.ts` + fixtures de planilha |
| **T-105a** | Mapeamento CSV do Nubank | P | T-105 | `lib/import/banks/nubank.ts` |
| **T-105b** | Mapeamento CSV do Santander | P | T-105 | `lib/import/banks/santander.ts` |
| **T-105c** | Mapeamento CSV do Mercado Pago | P | T-105 | `lib/import/banks/mercadopago.ts` |

---

## Mapa de paralelismo

```
T-100 (levantamento de formatos) ..... paralelo, nao bloqueia nada

T-001
  |
  +-- T-002
        |
        +-- T-004  (auth)
        |
        +-- T-003  (primitivos)
              |
              +-- T-101 --+-- T-110 -----------+
              +-- T-102   |                    |
              +-- T-103   |                    |
              +-- T-104   |                    |
              +-- T-121   |                    |
              |           |                    |
              +-- T-120 --+-- T-117 --+-- T-117b -+
                          |           +-- T-117c -+
                          +-- T-119 --------------+
                                                  |
                          T-107 -- T-108 -- T-111 -+
                                                  |
T-005 ------------------- T-109 -- T-113 ---------+
                          T-112 -- T-114 ---------+-- T-115 -- T-116
                                                  |
              T-201 --+-- T-206 -- T-207 ---------+
              T-202   |                           |
              T-203 --+-- T-205                   |
                          T-204 ------------------+-- T-208
                                                  |
              T-301 -- T-302 -- T-303 --+-- T-304 -+
                                T-305 --+-- T-306 -+
```

Gates humanos no caminho: T-001, T-002, T-116, T-208, T-301, T-306. (A sonda de PDF que era gate do T-117 já foi executada: ver `IMPORT-SOURCES.md` §2.)
T-120 e serial em relacao aos parsers: e o unico ponto de estrangulamento novo da Fase 1.

**Janelas de paralelismo maximo:**

| Janela | Tarefas | Agentes |
|--------|---------|---------|
| Motor puro (Fase 1) | T-101, T-102, T-103, T-104, T-121 | 5 |
| Parsers (depois de T-120) | T-117, T-119 | 2 |
| Parsers por banco (depois de T-117) | T-117b, T-117c | 2 |
| Motor da Fase 2 | T-201, T-202, T-203 | 3 |
| Telas da Fase 2 | T-204, T-205 | 2 |
| Fase 3 | T-303 + T-305 | 2 |

Fora dessas janelas: 2 a 3 agentes.
