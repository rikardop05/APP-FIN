# CONTRACTS — assinaturas do motor puro

> Declarações de interface, sem implementação. Um agente que recebe uma tarefa de `/lib` implementa **exatamente** esta assinatura: nome, parâmetros, formato de retorno.
> Mudar uma assinatura aqui declarada quebra os consumidores escritos por outros agentes em paralelo — só o orquestrador altera este arquivo.
> Tudo aqui é **função pura**: sem I/O, sem `Date.now()`, sem `process.env` (CONVENTIONS §5).

---

## 1. Primitivos — `/lib/money`

```ts
type Cents = number & { readonly __brand: 'Cents' }
type BasisPoints = number & { readonly __brand: 'BasisPoints' }

function cents(value: number): Cents                    // valida inteiro seguro
function basisPoints(value: number): BasisPoints        // idem, para o tipo BasisPoints
function formatBRL(v: Cents, opts?: { sign?: 'auto' | 'never' | 'always' }): string
function parseBRL(input: string): Cents | null          // aceita "1.234,56", "1234.56", "-R$ 10,00"
function addCents(...values: Cents[]): Cents
function applyRate(v: Cents, bp: BasisPoints): Cents    // arredonda para o centavo mais próximo
function allocate(total: Cents, parts: number): Cents[] // soma dos retornos === total, sempre
function bpToDecimal(bp: BasisPoints): number
```

## 2. Primitivos — `/lib/date`

```ts
type IsoDate = string      // 'YYYY-MM-DD'
type Competence = string   // 'YYYY-MM'

function toCompetence(d: IsoDate): Competence
function competenceStart(c: Competence): IsoDate
function competenceEnd(c: Competence): IsoDate
function addCompetence(c: Competence, months: number): Competence
function competenceRange(from: Competence, months: number): Competence[]
function clampDayToMonth(year: number, month: number, day: number): IsoDate  // dia 31 em fevereiro -> 28/29
function formatDateBR(d: IsoDate): string
function diffMonths(a: Competence, b: Competence): number
```

## 3. Faturas — `/lib/finance/billing.ts`

```ts
interface CardCycleConfig { closingDay: number; dueDay: number }

/** Em qual fatura cai uma compra. Se occurredOn > fechamento do mês, vai para o mês seguinte. */
function billingPeriodFor(occurredOn: IsoDate, cfg: CardCycleConfig): {
  competence: Competence
  closingDate: IsoDate
  dueDate: IsoDate      // se dueDay <= closingDay, vence no mês seguinte ao fechamento
}

function statementWindow(competence: Competence, cfg: CardCycleConfig): {
  from: IsoDate; to: IsoDate; closingDate: IsoDate; dueDate: IsoDate
}

/** differenceCents = computedTotal - reportedTotal. Positivo = somamos mais do que a fatura informou. */
function reconcileStatement(input: {
  reportedTotal: Cents | null
  transactions: { amountCents: Cents }[]
}): { computedTotal: Cents; differenceCents: Cents; matches: boolean }
```

## 4. Parcelas — `/lib/finance/installments.ts`

```ts
interface InstallmentPlanInput {
  totalCents: Cents
  installmentsCount: number
  firstCompetence: Competence
  description: string
  categoryId?: string | null
}

interface PlannedInstallment {
  installmentNumber: number
  competence: Competence
  amountCents: Cents
  description: string      // "Descrição (3/10)"
}

/** Gera as N parcelas. Soma === totalCents (usa allocate). */
function expandInstallmentPlan(input: InstallmentPlanInput): PlannedInstallment[]

/** Ao editar um plano: preserva parcelas já realizadas, regenera as futuras. */
function replanInstallments(input: InstallmentPlanInput, opts: {
  keepThroughCompetence: Competence
  settledCents: Cents
}): PlannedInstallment[]
```

## 5. Comprometimento futuro — `/lib/finance/commitment.ts`

```ts
interface CommitmentInput {
  transactions: { competence: Competence; amountCents: Cents; creditCardId: string; status: 'posted' | 'planned' }[]
  fromCompetence: Competence
  months: number
  cards: { id: string; name: string; creditLimitCents: Cents | null }[]
}

function futureCommitment(input: CommitmentInput): {
  byCompetence: { competence: Competence; totalCents: Cents; byCardId: Record<string, Cents> }[]
  totalCents: Cents
  lastCommittedCompetence: Competence | null   // ULTIMO mes da janela com saldo DEVEDOR
  limitUsage: { cardId: string; usedCents: Cents; usageBp: BasisPoints | null }[]
}
```

> **Semantica de `lastCommittedCompetence`** — fixada em 2026-09-16, apos conflito entre tres fontes
> apontado pelo Esquadro no T-110 e confirmado pelo Corvo.
>
> E o **ultimo mes da janela cujo `totalCents` e negativo**, ou seja, o ultimo mes em que ainda se
> deve dinheiro. `null` quando nao ha nenhum mes devedor na janela.
>
> Tres razoes para esta leitura, e nao "primeiro mes que zera":
> 1. e o que o **nome do campo** diz. `lastCommitted` = ultima competencia comprometida. A outra
>    leitura tornaria o nome mentiroso, e nome mentiroso e o defeito que mais custa caro depois.
> 2. **sempre tem resposta.** "Primeiro mes que zera" nao existe quando as parcelas passam do fim
>    da janela - e o caso comum de um parcelado em 24x visto numa janela de 24 meses.
> 3. o mes seguinte e derivavel em uma linha por quem quiser exibi-lo; o caminho inverso perde
>    informacao.
>
> **Mes com saldo POSITIVO nao conta.** Um mes que so tem estorno (entrada liquida) nao e
> comprometimento: nao se deve nada nele. O criterio e `totalCents < 0`, nunca `!= 0`. Contar
> estorno faria a tela dizer "voce termina de pagar em marco" apontando um mes em que a familia
> na verdade RECEBE dinheiro.
>
> **Para a tela (T-113 e RF-CC-03):** o texto "o mes em que o comprometimento zera" do SPEC e
> redacao de UI, nao semantica de dado. A tela exibe a partir deste campo o mes em que a familia
> termina de pagar.

## 6. Categorização — `/lib/finance/categorization.ts`

```ts
interface Rule {
  id: string; pattern: string; matchType: 'contains' | 'regex' | 'exact'
  categoryId: string; memberId: string | null; priority: number; active: boolean
}

/** Primeira regra que casa, por priority asc, id asc como desempate. Regex inválida é ignorada, nunca lança. */
function matchRule(rules: Rule[], description: string): Rule | null

function categorizeBatch(rules: Rule[], rows: { id: string; description: string }[]):
  Record<string, { categoryId: string; memberId: string | null; ruleId: string }>

/**
 * Sugere o padrão de uma nova regra a partir de uma descrição: remove parcelas, datas, códigos e dígitos variáveis.
 * Devolve o padrão NORMALIZADO (minúsculo), e `matchRule` compara sem diferenciar caixa.
 * Invariante (RF-CAT-03): a regra sugerida tem de casar com a descrição que a gerou e com outras parcelas da mesma compra.
 */
function suggestRulePattern(rawDescription: string): { pattern: string; matchType: 'contains' }
```

## 7. Deduplicação — `/lib/finance/dedupe.ts`

```ts
function normalizeDescription(raw: string): string   // minúsculo, sem acento, espaços colapsados, sufixo de parcela removido

function dedupeHash(input: {
  sourceId: string          // credit_card_id ou account_id
  occurredOn: IsoDate
  amountCents: Cents
  rawDescription: string
}): string                  // sha256 hex
```

## 8. Recorrência — `/lib/finance/recurrence.ts`

```ts
interface RecurrenceInput {
  expectedCents: Cents
  dueDay: number
  frequency: 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual' | 'one_off'
  startsOn: IsoDate
  endsOn: IsoDate | null
  annualAdjustmentBp: BasisPoints | null
  oneOffCompetence?: Competence | null
}

interface PlannedOccurrence { competence: Competence; date: IsoDate; amountCents: Cents }

/** Ocorrências previstas na janela. Aplica reajuste anual no aniversário de startsOn. */
function expandRecurrence(input: RecurrenceInput, window: { from: Competence; months: number }): PlannedOccurrence[]
```

### `dueDay` é a regra; `startsOn` é o piso

Fixado em 2026-09-23 (dúvida do Esquadro no T-201). O contrato declarava os dois campos mas não
dizia como se combinam quando a data de início cai **depois** do dia de vencimento no mês inicial.

**Toda ocorrência cai no `dueDay`** (clampado para meses curtos — dia 31 vira 28/29/30 e **volta**
para 31 no mês seguinte, nunca "gruda"). **Nenhuma ocorrência cai antes de `startsOn`.** A cadência
é ancorada na **competência** de `startsOn`, e a primeira ocorrência é o primeiro vencimento dessa
cadência que caia em `startsOn` ou depois.

Exemplo — `startsOn = 2026-03-10`, `dueDay = 5`:

| Frequência | Ocorrências |
|---|---|
| mensal | `2026-04-05`, `2026-05-05`, `2026-06-05`, … |
| bimestral | `2026-05-05`, `2026-07-05`, `2026-09-05`, … |

Março é pulado porque `05/03` cai antes de `10/03`, mas **a cadência continua contada a partir de
março** — por isso o bimestral dá maio e não abril.

**Por que não as alternativas:**

- *Primeira ocorrência = a própria `startsOn`* faria a primeira cair num dia diferente de todas as
  outras (`10/03`, depois `05/04`, `05/05`…). O usuário informou "vence dia 5"; uma parcela no dia 10
  contradiz o que ele declarou, e a conciliação com o realizado erraria a janela de data.
- *Usar o `dueDay` já na competência de `startsOn`* geraria `05/03`, **antes** do início — o que
  contradiz o significado de "começa em".

A regra em uma frase: **`dueDay` decide o dia, `startsOn` decide a partir de quando, e nenhum dos
dois cede ao outro.**

**`one_off` segue a mesma regra, sem caso especial.** Gera **exatamente uma** ocorrência: o primeiro
`dueDay` que caia em `startsOn` ou depois. Quando `oneOffCompetence` vem preenchido, ele **fixa a
competência** e o dia continua sendo o `dueDay` clampado.

`oneOffCompetence` **ausente não significa "nenhuma ocorrência"**. Devolver lista vazia violaria o
aceite do T-201 e, pior, sumiria em silêncio com uma despesa que o usuário cadastrou — ele veria o
lançamento salvo e nunca projetado. O campo é opcional porque o schema só o tem em `incomes`, não em
despesas; ausência é o caso **normal** para despesa avulsa, não exceção.

> Nota de schema: `one_off_competence` existe em `incomes` e **não** em despesas recorrentes.
> Assimetria observada pelo Esquadro no T-201. Não foi corrigida — a regra acima torna a coluna
> dispensável para despesa —, mas fica registrada caso alguém encontre o caso que a exigia.

```ts
```

## 9. Conciliação previsto × realizado — `/lib/finance/reconcile.ts`

```ts
interface MatchCandidate { id: string; occurredOn: IsoDate; amountCents: Cents; categoryId: string | null }

/** Casa previsto com realizado: mesma categoria, valor dentro de toleranceBp, data dentro de dayWindow. Melhor par primeiro, sem reuso. */
function matchPlannedToPosted(
  planned: MatchCandidate[],
  posted: MatchCandidate[],
  opts: { toleranceBp: BasisPoints; dayWindow: number }
): {
  matches: { plannedId: string; postedId: string; score: number }[]
  unmatchedPlanned: string[]
  unmatchedPosted: string[]
}
```

### Critério de "melhor par" — fixado em 2026-09-24

Dúvida do Esquadro no T-202. O contrato declarava "melhor par primeiro" sem dizer o que torna um par
melhor que outro.

**A ordem é: menor diferença relativa de valor → menor diferença de dias → menor `id`.** O `score`
devolvido é o custo do par: a diferença relativa de valor em basis points inteiros, menor é melhor.

**O que torna isso simples é que `toleranceBp` e `dayWindow` já são filtros duros.** Todo candidato
que chega ao desempate **já passou nos dois** — está dentro da tolerância de valor *e* dentro da
janela de data. O desempate não decide "é este mesmo?", decide apenas qual entre aprovados.

Por isso a soma ponderada de valor e data foi descartada: ela exige escolher um peso arbitrário
(quanto vale um dia em basis points?), e **um pareamento errado fica inexplicável**. "Valor mais
próximo; a data desempatou" é uma frase que alguém entende ao investigar; "menor soma normalizada"
não é.

Valor antes de data porque **datas se aglomeram** — dia 5, 10 e 15 concentram vencimentos, então a
data discrimina pouco entre candidatos. Valor é o sinal mais espalhado. O caso em que o valor varia
de mês a mês (conta de luz) é tratado pela `toleranceBp` daquela despesa ser configurada mais larga,
não por inverter a ordem para todos.

O `id` no fim não é detalhe: sem ele, dois candidatos idênticos em valor e data resolveriam pela
ordem de chegada do banco, e a mesma conciliação daria resultados diferentes em máquinas diferentes.

### As outras quatro decisões do T-202 — fixadas em 2026-09-24

**Algoritmo: guloso sobre a lista GLOBALMENTE ordenada, não guloso por varredura.** Monte *todos* os
pares válidos (os que passam categoria, tolerância e janela), ordene pelo `score`, e percorra essa
lista atribuindo o par quando **os dois lados ainda estiverem livres**.

Isso não é o mesmo que "para cada realizado, pegue o primeiro previsto que serve" — e a diferença é
justamente a que produz os dois órfãos. Se o realizado A consome o previsto X que era o par quase
perfeito do realizado B, sobram A mal pareado e B sem par. Ordenar globalmente antes de atribuir faz
os melhores pares serem consumidos primeiro.

Não vale um algoritmo ótimo (Hungarian): a escala doméstica é de dezenas de linhas, e o ganho não
paga a complexidade nem a perda de explicabilidade.

**Base da tolerância: o valor PREVISTO.** `|posted − planned| / |planned|` em basis points. A
referência é o que o usuário configurou, não o que o banco mandou — senão a tolerância se desloca
junto com o erro que ela deveria detectar. `planned` zero não entra em candidato (divisão por zero).

**Categoria nula NÃO casa, nem com outra nula.** `categoryId` null significa *desconhecida*, e
desconhecida não estabelece "mesma categoria". Casar dois nulos seria parear por **ausência de
sinal**.

> Consequência deliberada: lançamento realizado ainda não categorizado nunca concilia. É o
> comportamento desejado — empurra o usuário a categorizar primeiro, que é a ação que de fato
> resolve a ambiguidade. Um pareamento automático ali esconderia a pendência real sob uma
> conciliação falsa.

**Diferença de dias: diferença absoluta em dias de calendário** entre os dois `occurredOn`, calculada
por `lib/date` (nunca aritmética de `Date`). `dayWindow` é **inclusivo**: `dayWindow: 3` aceita até 3
dias de distância, para mais ou para menos.

## 10. Orçamento — `/lib/finance/budget.ts`

```ts
function budgetStatus(input: {
  budgets: { categoryId: string; plannedCents: Cents }[]
  spent: { categoryId: string; amountCents: Cents }[]
  warnBp: BasisPoints
}): {
  categoryId: string; plannedCents: Cents; spentCents: Cents; remainingCents: Cents
  usageBp: BasisPoints | null; light: 'green' | 'yellow' | 'red'
}[]

function suggestBudgetFromHistory(
  history: { competence: Competence; categoryId: string; amountCents: Cents }[],
  opts: { months: number }
): { categoryId: string; suggestedCents: Cents }[]
```

## 11. Fluxo de caixa — `/lib/finance/cashflow.ts`

```ts
interface CashflowInput {
  openingBalanceCents: Cents
  fromCompetence: Competence
  months: number
  incomes: PlannedOccurrence[]
  recurringExpenses: PlannedOccurrence[]
  installments: { competence: Competence; amountCents: Cents }[]
  statementsDue: { competence: Competence; amountCents: Cents }[]
  plannedContributions: { competence: Competence; amountCents: Cents }[]
  adjustments?: { competence: Competence; amountCents: Cents; label: string }[]  // modo "e se"
}

function projectCashflow(input: CashflowInput): {
  months: {
    competence: Competence
    openingCents: Cents; incomeCents: Cents; expenseCents: Cents
    installmentsCents: Cents; statementsCents: Cents; contributionsCents: Cents
    netCents: Cents; closingCents: Cents; negative: boolean
  }[]
  firstNegativeCompetence: Competence | null
  minClosingCents: Cents
}
```

## 12. Investimento — `/lib/finance/investment.ts`

> Todas as fórmulas trabalham em **valores reais**. Detalhamento matemático em SPEC §5.6.

```ts
interface ScenarioParams { label: 'conservative' | 'moderate' | 'optimistic'; realReturnBp: BasisPoints; withdrawalBp: BasisPoints }

/** (R * 12) / w */
function targetPortfolio(desiredMonthlyIncome: Cents, withdrawalBp: BasisPoints): Cents

/** (1 + r)^(1/12) - 1 — jamais r/12 */
function monthlyRate(annualBp: BasisPoints): number

/** P0*(1+i)^n + A*((1+i)^n - 1)/i ; i === 0 => P0 + A*n */
function futureValue(p0: Cents, monthlyContribution: Cents, annualBp: BasisPoints, months: number): Cents

/** ln((T*i + A)/(P0*i + A)) / ln(1+i) ; null quando inalcançável */
function monthsToTarget(target: Cents, p0: Cents, monthlyContribution: Cents, annualBp: BasisPoints): number | null

/** (T - P0*(1+i)^n) * i / ((1+i)^n - 1) ; 0 quando o patrimônio atual já basta */
function requiredContribution(target: Cents, p0: Cents, annualBp: BasisPoints, months: number): Cents

/** FV * w / 12 */
function projectedMonthlyIncome(portfolio: Cents, withdrawalBp: BasisPoints): Cents

function accumulationCurve(input: {
  p0: Cents; monthlyContribution: Cents; annualBp: BasisPoints; months: number; withdrawalBp: BasisPoints
}): { month: number; competenceOffset: number; portfolioCents: Cents; passiveIncomeCents: Cents }[]

/** A tabela que a tela exibe: uma linha por cenário. */
function scenarioTable(input: {
  desiredMonthlyIncome: Cents
  currentPortfolio: Cents
  currentMonthlyContribution: Cents
  scenarios: ScenarioParams[]
  horizonsYears: number[]        // default [5, 10, 15, 20]
}): {
  label: ScenarioParams['label']
  targetPortfolioCents: Cents
  monthsWithCurrentContribution: number | null
  requiredByHorizon: { years: number; contributionCents: Cents }[]
  projectedIncomeWithCurrentPlanCents: Cents
  feasible: boolean
}[]

/** RF-INV-05: liga o planejamento ao orçamento real. */
function contributionFeasibility(input: {
  requiredContributionCents: Cents
  averageMonthlySurplusCents: Cents
}): { gapCents: Cents; feasible: boolean; surplusUsageBp: BasisPoints | null }
```

## 13. Metas — `/lib/finance/goals.ts`

```ts
function goalProgress(input: { targetCents: Cents; currentCents: Cents; targetDate: IsoDate | null; today: IsoDate }): {
  progressBp: BasisPoints
  remainingCents: Cents
  monthsRemaining: number | null
  requiredMonthlyCents: Cents | null
  onTrack: boolean | null
}

function emergencyFundTarget(input: { monthlyEssentialAverageCents: Cents; months: number }): Cents
```

## 14. KPIs — `/lib/finance/kpis.ts`

```ts
function monthlyKpis(input: {
  competence: Competence
  transactions: {
    amountCents: Cents; kind: TransactionKind; status: 'posted' | 'planned'
    categoryNature: 'essential' | 'non_essential' | 'investment' | 'income'
  }[]
  futureInstallmentsCents: Cents
  uncategorizedCount: number
}): {
  incomeCents: Cents; expenseCents: Cents; contributionsCents: Cents
  surplusCents: Cents; savingsRateBp: BasisPoints | null; essentialShareBp: BasisPoints | null
  futureInstallmentsCents: Cents; uncategorizedCount: number
}
```

```ts
/**
 * Gasto por categoria no mês, com variação contra a média dos 3 meses anteriores.
 * Conta apenas `kind === 'expense'`. Uma passada sobre as transações.
 */
function spendingByCategory(input: {
  competence: Competence
  transactions: { competence: Competence; amountCents: Cents; kind: TransactionKind; categoryId: string | null }[]
  categories: { id: string; name: string; nature: CategoryNature }[]
}): {
  categoryId: string; name: string; nature: CategoryNature
  spentCents: Cents                  // max(0, -liquido) — ver a regra de sinal abaixo
  average3mCents: Cents              // média das 3 competências anteriores
  variationBp: BasisPoints | null    // null quando a média é zero
}[]

/** Faturas cujo total informado não bate com a soma dos lançamentos. */
function divergentStatements(statements: {
  statementId: string
  reportedTotalCents: Cents | null
  transactions: { amountCents: Cents }[]
}[]): { statementId: string; differenceCents: Cents }[]
```

### Decisões fixadas em 2026-09-17 (perguntas do Esquadro no T-115)

**Regra crítica (RC-03/RC-04):** `transfer` e `credit_card_payment` **não entram em campo nenhum** —
nem em `expenseCents`, nem em `incomeCents`, nem em `contributionsCents`. São invisíveis ao KPI.
`investment_contribution` sai em `contributionsCents`, separado da despesa.

**Sinal — cada balde é o LÍQUIDO na sua direção natural, com piso em zero.** Corrigido em
2026-09-17, achado do Corvo na revisão do T-115; a primeira versão dizia "módulo", e estava errada.

```
incomeCents        = max(0,  soma dos kind 'income')
expenseCents       = max(0, −soma dos kind 'expense')
contributionsCents = max(0, −soma dos kind 'investment_contribution')
```

`surplusCents = income − expense` continua, e **pode** ser negativo — é déficit.

**Por que não é módulo.** O cenário que derruba a regra antiga: um mês (ou uma categoria) em que só
houve **estorno** — `kind: 'expense'` com valor **positivo**, dinheiro voltando. Em módulo, o painel
anunciaria *"despesa: R$ 50,00"* num mês em que a família **recebeu** R$ 50 de volta. Número
plausível e falso, que é o pior defeito possível aqui.

O mesmo espelho vale nos outros dois baldes, e por isso a regra é uniforme e não só para despesa:
estorno de receita (`income` negativo) não é ganho; resgate de investimento (`contribution`
positivo) não é aporte.

**Precedente que obriga esta escolha:** §5 já decidiu, no T-110, que *mês só com estorno não conta
como comprometimento* (`totalCents < 0`, nunca `!= 0`). Era a mesma família, o mesmo estorno e a
regra oposta. Duas leituras contraditórias do mesmo fato é exatamente o que produz número
inexplicável no painel.

**Limitação conhecida, deliberada:** quando o estorno supera o gasto, a sobra do estorno é **cortada
pelo piso** e não aparece em nenhum balde. Não vira receita, porque estorno não é ganho. É perda de
informação aceita em troca de nunca exibir "despesa negativa" num KPI. Não "conserte" isso sem
reabrir a decisão.

**Balde por `kind`, nunca por `categoryNature`.** `incomeCents` soma `kind: 'income'`; `expenseCents`
soma `kind: 'expense'`; `contributionsCents` soma `kind: 'investment_contribution'`. O
`categoryNature` entra **só** em `essentialShareBp`. Uma única fonte de verdade para classificar
dinheiro evita que as duas divirjam.

**`status`: soma `posted` e `planned`.** A família quer saber o custo do mês **inteiro**, não só o já
lançado — parcela que cai dia 28 é despesa daquele mês mesmo em dia 3. O comprometimento *além* do
mês já sai separado em `futureInstallmentsCents`.

**Fórmulas:**
- `surplusCents = incomeCents − expenseCents`. **Aporte NÃO é subtraído**: ele é *destino* da sobra,
  não redução dela. Subtrair contaria duas vezes quem investe.
- `savingsRateBp = surplus / income`, `null` quando `income` é zero.
- `essentialShareBp = despesa essencial / income`, `null` quando `income` é zero. É fração da
  **renda**, não da despesa — é a métrica de saúde financeira (regra 50/30/20), e fica coerente com
  `savingsRateBp`, que também é sobre a renda.

**`spendingByCategory` — quais categorias saem na lista:** as que tiveram gasto no mês **ou** em
qualquer um dos 3 meses anteriores. Categoria zerada nos quatro fica **fora**. O motivo de não
filtrar só pelo mês corrente: categoria que sumiu é sinal, não ausência — `spentCents: 0` com
`average3mCents` alto é exatamente o que a família precisa ver.

**Comprometimento futuro resumido: NÃO ganha assinatura nova.** `futureCommitment` (§5) já devolve
`totalCents` e `lastCommittedCompetence`, que *é* o resumo. A tela chama aquilo direto. Criar um
invólucro em `kpis.ts` seria camada redundante sobre função pura já testada.

## 15. Importação — `/lib/import`

> **v1:** `types.ts` + `detect.ts` (T-120), `installments.ts` (T-121), `pdf/` (T-117), `text.ts` (T-119), `pipeline.ts` (T-107).
> **Fase 4:** `ofx.ts` (T-106 — nenhum dos três bancos oferece OFX), `csv.ts` (T-105), `xlsx.ts` (T-118) e os tipos de mapeamento de coluna. Declarados aqui para estabilidade de contrato, **não implementar na v1**.

```ts
// xlsx.ts — T-118, FASE 4 (adiado junto com o CSV)
function parseXlsx(bytes: Uint8Array, mapping: ImportMapping): ParseResult

// pdf/ — T-117. Implementacao sobre pdfjs-dist; extrator artesanal e proibido.
interface PdfTextItem {
  page: number
  x: number; y: number        // origem do run, em pontos, no espaco da pagina
  width: number
  text: string
}
interface PdfTextRow {
  page: number
  y: number
  cells: { x: number; text: string }[]   // ordenadas por x
  text: string                            // celulas unidas por espaco, para heuristica simples
}

/**
 * Extrai os runs de texto com coordenadas.
 * - decifra quando necessario (opts.password); Santander usa RC4, Mercado Pago AES-256
 * - decodifica sempre pelo ToUnicode CMap do proprio arquivo (subset Type0 do Nubank, CID do Mercado Pago)
 * - PDF cifrado sem senha correta: lanca PdfPasswordError, NAO retorna vazio
 * - a senha nunca aparece em log, mensagem de erro ou retorno
 * - ASSINCRONA por necessidade: pdfjs-dist so expoe getDocument().promise e getTextContent()
 *   assincronos, e extrator artesanal e proibido. Corrigido em 2026-09-16, achado do Peneira
 *   no T-117. groupIntoRows, parseNubankPdf e detectPdfIssuer seguem SINCRONAS: recebem dados
 *   ja extraidos. So quem le bytes precisa de await, e esse caminho (T-107, T-108) ja e async.
 */
function extractPdfTextItems(bytes: Uint8Array, opts?: { password?: string }): Promise<PdfTextItem[]>

/**
 * RF-IMP-12: remonta linhas a partir das coordenadas. Infraestrutura COMUM aos tres bancos.
 * O Santander emite cada celula como run separado: 884 runs, apenas 1 com data e valor juntos.
 * Agrupa por y (com tolerancia, default 2pt) e ordena por x.
 */
interface GroupIntoRowsOptions {
  yTolerance?: number                                  // default 2pt
  xBands?: readonly (readonly [number, number])[]      // ver a nota abaixo
}
function groupIntoRows(items: PdfTextItem[], opts?: GroupIntoRowsOptions): PdfTextRow[]

/**
 * Parsers por banco: mapeiam faixas de x para data | descricao | valor.
 *
 * O segundo parametro e OPCIONAL e aditivo, e os tres bancos convergiram para a
 * mesma forma sem combinarem — sinal de que o problema e do dominio, nao do layout:
 * NENHUM dos tres imprime o ano na linha de lancamento.
 *
 *   interface <Banco>PdfParseOptions { defaultYear?: number }
 *
 * PRECEDENCIA DO ANO, obrigatoria e igual nos tres:
 *   1. cabecalho do proprio arquivo (Nubank §6.2, Santander §8.2, MP §7);
 *   2. defaultYear, informado pelo chamador;
 *   3. nada disso: `occurredOn: null`, confidence baixa, o usuario completa na
 *      tela de confirmacao. A linha NUNCA e descartada.
 *
 * O relogio NAO entra em nenhum degrau. Assumir "ano atual" quebra em silencio
 * toda janeiro, quando se importa a fatura de dezembro — e o ESLint bloqueia
 * `new Date()` em lib/import de proposito.
 */
function parseNubankPdf(rows: PdfTextRow[], opts?: NubankPdfParseOptions): ParseResult          // T-117
function parseSantanderPdf(rows: PdfTextRow[], opts?: SantanderPdfParseOptions): ParseResult    // T-117b
function parseMercadoPagoPdf(rows: PdfTextRow[], opts?: MercadoPagoPdfParseOptions): ParseResult // T-117c

/** Identifica o banco pelo conteudo das primeiras linhas, para escolher o parser. */
function detectPdfIssuer(rows: PdfTextRow[]): 'nubank' | 'santander' | 'mercadopago' | null

// xBands — acrescentado em 2026-09-16, medicao do Santander (IMPORT-SOURCES §8).
//
// O PROBLEMA: na fatura do Santander DUAS TABELAS INDEPENDENTES dividem as mesmas
// linhas `y`. Lancamentos ficam em x < 250; um quadro-resumo fica em x > 320. Na
// mesma y=425 convivem uma compra e um totalizador sem relacao entre si.
//
// Agrupar so por `y` cola as duas. As celulas preservam o `x`, entao um parser
// consegue filtrar — mas o campo `text` da linha (celulas unidas por espaco) sai
// contaminado, e e ele que alimenta heuristica simples, inclusive detectPdfIssuer.
//
// A SOLUCAO: faixas de `x` DECLARADAS pelo parser do banco, que e quem conhece a
// geometria. Sem `xBands` nada muda — o default continua sendo uma linha por `y`,
// que e o caso do Nubank e do Mercado Pago.
//
//   groupIntoRows(items, { xBands: [[0, 250], [320, 595]] })
//
// POR QUE NAO DETECCAO AUTOMATICA DE VAO: no Nubank a data esta em x=123, a
// descricao em 185 e o valor em ~496. O vao entre descricao e valor e enorme e e
// coluna legitima da MESMA tabela. Um limiar fixo partiria toda linha de lancamento
// do Nubank em duas. Deteccao automatica exigiria achar corredores verticais que
// PERSISTEM pela pagina inteira — bem mais caro, e desnecessario quando o parser
// ja sabe a geometria do proprio banco.
//
// Celula fora de TODAS as faixas vira linha propria, nunca e descartada: e a regra
// de "nenhuma linha some em silencio" aplicada a geometria.

// N/M AMBIGUO: QUEM DECIDE O QUE - atualizado em 2026-09-24
//
// A divisao entre o parser de texto e o pipeline mudou depois do exercicio de
// ponta a ponta da T-111. Ela agora e:
//
// - text.ts (T-119) resolve o caso do candidato UNICO: se o `N/M` e a unica
//   coisa que pode ser data na linha, vira DATA, com confidence 'low' e o
//   sourceLine intacto. Precisa de `defaultCompetence` para ter o ano; sem ele,
//   devolve occurredOn null;
// - o pipeline (T-107) desempata quando ha OUTRA data na linha: um `N/M` que
//   coincide com o dia e o mes do `occurredOn` e data, nao parcela.
//
// POR QUE A DIVISAO E ESSA: o desempate do T-107 compara com o `occurredOn`. Se
// o parser tivesse consumido a unica data como parcela, `occurredOn` viria null
// e o desempate ficaria inalcancavel - foi exatamente o que acontecia com
// "01/09 UBER -25,50".
//
// A REGRA DE SEGURANCA que orienta os dois: errar para DATA custa ao usuario
// marcar a parcela a mao; errar para PARCELA deixa a linha sem data E projeta M
// meses de despesa que talvez nao exista. Os dois erros nao custam o mesmo.
// **REVISAVEL**: e heuristica, nao regra de dominio fechada.

// text.ts — T-119, fallback universal
type ParseConfidence = 'high' | 'medium' | 'low'
interface TextParseOptions {
  defaultCompetence?: Competence   // usada quando a linha nao tem ano
  dateOrder?: 'dmy' | 'mdy' | 'ymd'
}
interface TextParsedRow extends ParsedRow {
  confidence: ParseConfidence
  sourceLine: string               // linha original, sempre preservada
  missing: ('date' | 'amount' | 'description')[]
}
/**
 * Parser heuristico de texto colado. Por linha: acha o token de data, o token de valor
 * (o ultimo da linha) e usa o resto como descricao.
 * Linha que nao rende data+valor NAO e descartada: volta com confidence 'low',
 * `missing` preenchido e `sourceLine`, para o usuario completar na confirmacao.
 */
function parsePastedText(raw: string, opts?: TextParseOptions): ParseResult & { rows: TextParsedRow[] }

// types.ts — T-120, pre-requisito de todo parser
// ColumnMap e ImportMapping: FASE 4 (T-105). Nao declarar na v1 - nenhum parser da v1 os consome.
interface ColumnMap { date: string; description: string; amount?: string; debit?: string; credit?: string }
interface ImportMapping {
  bankKey: string; format: 'csv' | 'xlsx'; columnMap: ColumnMap
  dateFormat: string; decimalSeparator: ',' | '.'; amountSignInverted: boolean
}
interface ParsedRow {
  occurredOn: IsoDate | null      // null = nao lido na origem; o usuario preenche na confirmacao
  rawDescription: string
  amountCents: Cents | null       // null = nao lido; NAO confundir com cents(0), que e R$ 0,00 real
  fitId?: string | null           // OFX
  installment?: { current: number; total: number } | null
}
interface ParseDiagnostic { line: number; message: string; raw: string }
interface ParseResult { rows: ParsedRow[]; diagnostics: ParseDiagnostic[]; reportedTotalCents: Cents | null }

// NULABILIDADE DE occurredOn E amountCents - fixada em 2026-09-16, achado do Funil no T-119,
// severidade alta, confirmado pelo Corvo.
//
// A regra RF-IMP "nenhuma linha e descartada em silencio" obriga a devolver a linha que o parser
// nao conseguiu ler por inteiro. Com os campos obrigatorios, a unica saida era um sentinela
// (occurredOn '' e cents(0)) - e sentinela aqui MENTE de duas formas:
//   1. cents(0) e um valor legitimo. Uma compra de R$ 0,00 existe, entao "zero" fica ambiguo
//      entre "nao li" e "li e e zero";
//   2. '' nao e um IsoDate valido, e billingPeriodFor('') LANCA. O erro aparece longe da causa,
//      em runtime, no meio da importacao.
//
// Com null, o compilador OBRIGA todo consumidor (T-107, T-108, T-111) a tratar o caso ausente.
// Vira erro de compilacao, nao bug silencioso - e e exatamente o que a RF-IMP-02 exige, porque a
// tela de confirmacao existe para o usuario completar essas linhas antes de qualquer gravacao.
//
// Consequencia para quem consome: linha com occurredOn ou amountCents null NAO pode ser gravada.
// Ou o usuario completa na confirmacao, ou ela e excluida do lote por decisao dele.

// csv.ts — T-105, FASE 4 (adiado). Contrato declarado para que XLSX e detect ja componham com ele.
function parseCsv(content: string, mapping: ImportMapping): ParseResult

// ofx.ts — T-106, FASE 4 (nenhum banco da familia oferece OFX)
function parseOfx(content: string): ParseResult & { accountHint: string | null }

// detect.ts — T-120
// Na v1 os formatos aceitos sao 'ofx' e 'pdf'; 'unsupported' cobre .csv/.xls/.xlsx com mensagem
// orientando o caminho de texto colado. 'csv'/'xlsx' passam a ser aceitos na Fase 4.
// v1: aceita 'pdf'. 'unsupported' cobre .ofx/.csv/.xls/.xlsx, com hint orientando o texto colado.
function detectSource(input: { fileName: string; content: string | Uint8Array }):
  { format: 'pdf' | 'unsupported' | null; bankKey: string | null; encrypted: boolean; hint: string | null }

// installments.ts — T-121 (v1)
/**
 * Reconhece "PARC 03/10", "3/10", "PARCELA 3 DE 10", "(3 de 10)". Devolve descricao limpa.
 * LIMITE CONHECIDO: "03/10" solto e ambiguo - pode ser 3 de outubro. Esta funcao so recebe a descricao
 * e nao tem como desempatar. O filtro N <= M elimina a maioria das datas, mas sobra residuo.
 * O desempate final e do buildImportPreview (secao 15, T-107), que tem o occurredOn da linha.
 *
 * TETOS DE total, decididos pelo humano em 2026-09-10:
 *   MAX_TOTAL          = 99  quando ha evidencia direta (PARC, PARCELA, ou a forma por extenso
 *                            'N de M'). Quem escreveu 'PARCELA 2 DE 60' disse que e parcela, e
 *                            nao cabe a heuristica desmentir. Alinhado com MAX_INSTALLMENT_COUNT
 *                            de lib/finance/dedupe.ts: os dois modulos leem o mesmo sufixo e nao
 *                            podem divergir.
 *   MAX_TOTAL_UNMARKED = 24  sem evidencia direta. Assimetria de custo: falso negativo o usuario
 *                            corrige em dois cliques na confirmacao; falso positivo cria despesa
 *                            fantasma discreta, projetada por ate M meses, numa fatura de 40 linhas.
 */
function detectInstallment(rawDescription: string):
  { current: number; total: number; cleanDescription: string } | null

// pipeline.ts — T-107, junta tudo: e o que a rota de API chama
function buildImportPreview(input: {
  parse: ParseResult
  sourceId: string
  sourceKind: 'credit_card' | 'account'
  cardCycle: CardCycleConfig | null
  rules: Rule[]
  existingHashes: Set<string>
  today: IsoDate
}): {
  rows: {
    index: number
    occurredOn: IsoDate; competence: Competence; description: string; rawDescription: string
    amountCents: Cents; dedupeHash: string
    suggestedCategoryId: string | null; suggestedMemberId: string | null
    state: 'new' | 'duplicate' | 'installment_first' | 'installment_part'
    installment: { current: number; total: number } | null
  }[]
  summary: {
    rowsRead: number; rowsNew: number; rowsDuplicated: number
    installmentPlansDetected: number; totalCents: Cents
    uncategorizedCount: number
  }
  // INVARIANTE DO summary, fixada em 2026-09-23 (duvida do Peneira no T-107):
  //
  //   rowsNew + rowsDuplicated === rowsRead
  //
  // `rowsNew` e "toda linha que NAO e duplicata", ou seja, tudo que sera importado -
  // inclui os quatro estados menos 'duplicate' (new, installment_first,
  // installment_part). NAO e "state === 'new'" literal.
  //
  // Por que: toda linha lida tem de cair em EXATAMENTE um balde, senao o resumo nao
  // fecha na conta e o usuario nao consegue conferir. Com a leitura literal, um lote de
  // 1 duplicata + 1 parcelada + 3 novas daria rowsNew=3 e rowsDuplicated=1 sobre 5
  // lidas - e a quinta linha ficaria invisivel na aritmetica, sem o usuario saber o que
  // houve com ela.
  //
  // `installmentPlansDetected` e ORTOGONAL, nao um terceiro balde: conta PLANOS, nao
  // linhas. Uma parcelada em 10x e 1 plano. A tela le "5 lidas: 4 novas (1 inicia
  // parcelamento em 10x), 1 duplicada".
  diagnostics: ParseDiagnostic[]
}
```

## 16. Confirmação e commit — `/lib/import/finalize.ts`

> A tela de confirmação (RF-IMP-02) devolve **linhas editadas pelo usuário**. É isso que vira lançamento, não o que o parser leu. Competência e hash são recalculados aqui (RF-IMP-09), em função pura e testada.

```ts
interface ConfirmedRow {
  index: number
  include: boolean                 // false = usuario excluiu a linha do lote
  occurredOn: IsoDate              // editavel
  description: string              // editavel
  rawDescription: string           // imutavel; vazio quando a origem e texto colado sem original
  amountCents: Cents               // editavel, com sinal
  categoryId: string | null        // editavel
  memberId: string | null          // editavel
  installment: { current: number; total: number } | null   // editavel
  forceDuplicate?: boolean         // usuario decidiu incluir mesmo sendo duplicata
}

interface FinalizeInput {
  rows: ConfirmedRow[]
  sourceId: string
  sourceKind: 'credit_card' | 'account'
  cardCycle: CardCycleConfig | null
  existingHashes: Set<string>
  reportedTotalCents: Cents | null
}

/**
 * Converte linhas confirmadas no que sera persistido.
 * - recalcula competence via billingPeriodFor a partir da data EDITADA
 * - recalcula dedupeHash a partir dos valores CONFIRMADOS
 * - agrupa linhas parceladas em installment_plans e projeta as parcelas futuras
 * - devolve o que foi ignorado e por que, para a UI mostrar
 */
function finalizeImport(input: FinalizeInput): {
  transactions: {
    occurredOn: IsoDate; competence: Competence; cashDate: IsoDate | null
    description: string; rawDescription: string; amountCents: Cents
    categoryId: string | null; memberId: string | null
    dedupeHash: string
    installmentPlanRef: number | null; installmentNumber: number | null
  }[]
  installmentPlans: {
    ref: number; description: string; totalCents: Cents
    installmentsCount: number; firstCompetence: Competence; categoryId: string | null
  }[]
  skipped: { index: number; reason: 'excluded_by_user' | 'duplicate' }[]
  totals: { includedCents: Cents; reportedCents: Cents | null; differenceCents: Cents | null; matches: boolean | null }
}
```

**Invariante de teste obrigatória:** editar a data de uma linha muda sua `competence` e seu `dedupeHash`; editar o valor muda o hash e o total do lote; excluir uma linha a remove de `transactions` e a lista em `skipped`.

## 17. Sessão e contexto de household — `/lib/auth/session.ts`

> **Declarado em 2026-09-16.** O `BUILD-PLAN` do T-004 exigia "resolução de `household_id` e
> `member_id` da sessão em um helper único", mas a assinatura nunca foi escrita aqui — e T-108,
> T-109, T-112 e T-114 dependem dela. Sem esta seção, quatro agentes inventariam quatro versões.

```ts
// Implementado como `AppSession`, em lib/auth/app-session.ts.
type AppSession = {
  householdId: string
  memberId: string
}

/**
 * Única porta de entrada para `householdId` e `memberId`. Nenhuma rota, query ou
 * componente os obtém de outro lugar — nem de env, nem de cookie lido à mão,
 * nem de parâmetro de URL.
 *
 * **Lança** quando não há sessão válida. Não devolve `null`: ver a nota abaixo.
 */
class SessionMissingError extends Error {}   // o que requireSession lanca

function requireSession(): Promise<AppSession>

/** Versão não-lançante, só para onde a ausência de sessão é estado legítimo (ex.: a própria /login). */
function getSession(): Promise<AppSession | null>
```

**Por que `requireSession` lança em vez de devolver `null`** — e por que isso *não* contradiz a
decisão oposta tomada em `ParsedRow` (§15):

Em `ParsedRow`, o campo ausente é um estado **legítimo e esperado** — a linha incompleta existe e o
usuário vai completá-la. Ali `null` é certo, porque obriga cada consumidor a tratar um caso que vai
mesmo acontecer.

Aqui é o contrário. Numa rota protegida, "sem sessão" **não é** um estado que o chamador deva tratar
inline: o middleware já redirecionou antes. Se acontecer, é erro. E o modo de falha que precisamos
tornar impossível é específico: um `null` esquecido faria a query rodar **sem** `household_id` — ou
seja, devolvendo dados do outro household. Uma checagem esquecida vira vazamento silencioso entre as
duas pessoas da família. Lançar torna o esquecimento impossível.

A regra que sustenta isso: **toda query filtra `household_id`**, e o único lugar de onde esse valor
sai é `requireSession()`.

> **Correção de 2026-09-16, poucas horas depois:** esta seção nasceu declarando `SessionContext` com
> um terceiro campo, `email`. A implementação entregou `AppSession` com apenas os dois ids, e o
> contrato foi ajustado para a implementação — não o contrário — por um motivo de mérito: **manter o
> e-mail fora do token de sessão reduz o dado pessoal em circulação**, e `memberId` já resolve
> "quem está logado" para a UI. A versão implementada é melhor que a declarada.
>
> Isto **não** é precedente para divergir do contrato sem avisar. A mudança deveria ter sido
> proposta antes, não descoberta na validação — o custo aqui foi baixo só porque um único consumidor
> tinha compilado contra ela.

> **`SessionMissingError`, acrescentada em 2026-09-16 na validação do T-109.** O consumidor precisa
> distinguir "sem sessão" (vira **401**) de qualquer outra falha (vira **500**). A primeira versão
> lançava um `Error` cru, e as rotas passaram a testar `error.message.startsWith('Sessao ausente')`
> — em quatro arquivos, de outro dono.
>
> Isso transformava **a mensagem de erro em API**: bastava reformular o texto em `session.ts` para as
> quatro rotas pararem de reconhecer o caso e devolverem 500 no lugar de 401, sem erro de compilação
> e sem teste vermelho. O usuário deslogado veria "erro interno" em vez de ir para o login.
>
> Por isso o contrato é a **classe**, não o texto. Consumidores testam `instanceof
> SessionMissingError`; a mensagem fica livre para mudar.
