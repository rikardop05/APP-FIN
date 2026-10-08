# Clarify: números que se contradizem entre telas (2026-10-08)

Autor: Esquadro (motor). Origem: crítica `2026-10-08T19-03-11Z__app-app.md`, P1 "Números contraditórios".
Escopo: investigação e proposta. Nenhum arquivo de código foi alterado. A decisão final de nomes é do Ricardo.

Valores conferidos no banco de produção, em modo só leitura, no household "Casa", em 2026-10-08. O Corvo reconferiu todas as contas e as referências arquivo:linha.

**Premissa que atravessa os três casos: competência não é mês do calendário.** Em cartão, a competência é a da **fatura**. Santander e Nubank fecham no dia 1, então a despesa de cartão da competência out/26 são compras de 02/09 a 01/10. Todo rótulo com mês precisa dizer, na linha de base, que é competência.

## Veredito curto

| Caso | Bug no motor? | Causa da contradição |
|---|---|---|
| (a) Sobra +6.633,91 × −2.709,16 | Não | Mês e período diferentes, e regras diferentes do que entra. Nenhum dos dois rótulos diz qual é o seu. |
| (b) Parcelas a vencer 2.366,15 × Total comprometido 3.132,24 | Não | Janelas deslocadas em um mês e conjuntos diferentes. O texto de ajuda do "Total comprometido" está **factualmente errado**. |
| (c) Aportes 0,00 × plano 500 | Não | Realizado × premissa do plano. O rótulo "Aporte mensal atual" sugere realizado. |

## (a) Sobra

### Painel, "Sobra do mês" = **+R$ 6.633,91**
- Tela: `components/dashboard/kpis-row.tsx:81`.
- Motor: `monthlyKpis`, em `lib/finance/kpis.ts:197`, com `surplusCents = incomeCents − expenseCents` (linha 244).
- Dados: `getDashboardData`, em `lib/db/queries/dashboard.ts:137-161`.
- **Definição:** competência corrente (out/26), status `posted` **e `planned`** (`COUNTED_STATUSES`). Receita é a parte positiva da soma de `income`. Despesa é a saída líquida de `expense`, com piso em zero por balde. Aporte, transferência e pagamento de fatura ficam fora.
- **Conta:** receita lançada na competência out/26, de R$ 7.400,00, menos as parcelas previstas da competência out/26, de R$ 766,09 (11,63 + 178,22 + 576,24), dá R$ 6.633,91. Faltam importar as faturas de out/26: as do Santander e do Nubank já fecharam, e a do Mercado Pago fica aberta até 14/10. O número é de uma competência **em andamento** e vai cair quando elas entrarem.

### Investimentos, "Sua sobra real: −R$ 2.709,16 por mês"
- Tela: `components/investment/feasibility/feasibility.tsx:29`, com a base em `components/investment/feasibility/text.ts:72`.
- Dados: `getSurplusData`, em `lib/db/queries/investment.ts:232`.
- Média: `averageMonthlySurplus`, em `app/api/investment/compute.ts:72`.
- **Definição:** os 3 meses **fechados** antes do corrente (jul–set/26), só `posted`. Entram apenas os meses com algum lançamento (agosto só tem previsão e sai). A sobra de cada mês é a soma bruta de `income` + `expense`.
- **Conta:** julho dá −R$ 1.469,01 (−1.299,89 − 169,12) e setembro dá −R$ 3.949,31 (−453,89 − 2.210,75 − 620,93 − 663,74). A média é (−1.469,01 − 3.949,31) / 2 = −R$ 2.709,16.
- **Por que deu negativo:** não há **nenhuma receita lançada em jul–set**. O salário só foi registrado em outubro. A média mede "meses só com despesa", não a sobra da casa. É lacuna de dados, não de cálculo, mas a tela não avisa.

### Divergências reais de definição (fora de `lib/finance`, para o dono decidir)
1. **Soma bruta × piso por balde.**
   - `getSurplusData` soma `income` e `expense` brutos.
   - `monthlyKpis` aplica piso em zero por balde. Num mês em que o estorno supera a despesa, o Painel mostra despesa 0, e Investimentos conta o excesso como receita.
   - Proposta: a sobra mensal de Investimentos sai de `monthlyKpis` aplicado a cada mês. Assim existe uma definição só de "sobra de um mês".
2. **Mês sem receita entra na média.**
   - Proposta: avisar na própria linha ("jul e set não têm receita lançada").
   - Alternativa, que precisa de decisão do Ricardo: tirar da média os meses sem receita.

## (b) Comprometimento futuro (dois números no Painel)

### "Parcelas a vencer (24 m)" = **R$ 2.366,15**
- Tela: `components/dashboard/kpis-row.tsx:115`, dentro de "Resumo do mês".
- Dados: soma SQL em `lib/db/queries/dashboard.ts:163-180`, repassada por `monthlyKpis.futureInstallmentsCents`.
- **Definição:** só parcelas de parcelamento (`installment_plan_id`), `planned`, `expense`, de **nov/26 a out/28**. O mês corrente fica fora, porque já está em "Despesa do mês".

### "Total comprometido (24 m)" = **R$ 3.132,24**
- Tela: `components/dashboard/commitment-summary.tsx:83`.
- Motor: `futureCommitment`, em `lib/finance/commitment.ts:124`.
- Dados: `listCommitmentTransactions`, em `lib/db/queries/dashboard.ts:355`.
- **Definição:** linhas de **cartão** de **out/26 a set/28**: lançadas (`posted`, inclusive compra à vista e estorno) e parcelas de plano. Pagamento de fatura e transferência ficam fora.
- **Conta:** R$ 3.132,24 − R$ 2.366,15 = R$ 766,09, exatamente as parcelas de out/26. Hoje a diferença é só o mês corrente. Em geral, as janelas diferem nas duas pontas:
  - o mês corrente (out/26) só está no "Total comprometido";
  - o último mês (out/28) só está em "Parcelas a vencer";
  - as compras à vista já lançadas em competências futuras (feitas depois do fechamento) só estão no "Total comprometido".

### Erro de texto (factual)
- `commitment-summary.tsx:87` diz "Soma de **todas as parcelas** na janela". O número também soma compras à vista já lançadas e estornos. O próprio comentário em `components/dashboard/commitment-chart.tsx:24-27` reconhece isso ("não prometo só parcelas").
- Correção sugerida (só texto): "Compras lançadas e parcelas nos cartões, de out/26 a set/28."
- Não apliquei porque a tarefa pede para não mudar UI.

### Um card só? Sim.
"Parcelas a vencer" é um número de **futuro** e está dentro de "Resumo do mês", que é um bloco de passado e presente. Os dois números são fatias do mesmo comprometimento. Proposta: um card único, com o total no topo e o detalhamento que fecha a soma.

```
Comprometido nos cartões                     R$ 3.132,24
faturas de out/26 a set/28 · compras lançadas e parcelas
  Faturas de out/26                            R$ 766,09
  Parcelas das faturas de nov/26 em diante   R$ 2.366,15
  Compras já lançadas em faturas futuras         R$ 0,00   (só aparece quando > 0)
Termina de pagar em mm/aaaa
```

**Para a soma fechar, as três linhas têm de sair do MESMO `futureCommitment().byCompetence`** (out/26 a set/28): a competência corrente de um lado, as demais do outro. Reaproveitar o `futureInstallmentsCents` de hoje (nov/26 a out/28) na segunda linha quebra a soma no mês em que out/28 tiver parcela. Separar parcela de compra lançada pede um campo a mais por mês no motor. Isso fica para quando o Ricardo aprovar o card, como mudança de contrato em `lib/finance/commitment.ts`, que é minha. O KPI "Parcelas a vencer" sai do "Resumo do mês".

## (c) Aportes

### Painel, "Aportes" = **R$ 0,00**
- Tela: `components/dashboard/kpis-row.tsx:104`.
- Motor: `monthlyKpis.contributionsCents`, saída líquida de `investment_contribution` (`lib/finance/kpis.ts:218` e `:243`).
- **Definição:** lançamentos de aporte em out/26 (`posted` + `planned`). Não há nenhum, então dá zero. Está correto.

### Investimentos, "Aporte mensal atual" = **R$ 500,00**
- Tela: `components/investment/investment-screen.tsx:96`.
- Dado: `investment_plans.current_monthly_contribution_cents`.
- **Definição:** premissa digitada no plano ("quanto você consegue investir por mês hoje"). Não é lançamento. A palavra "atual" faz parecer que é o realizado.

### Terceira fonte, já coerente
"Aporte efetivo × planejado" em `/investimentos/posicoes` (`lib/db/queries/investment-positions.ts:179`) usa **só `posted`**. O Painel usa `posted` + `planned`. Num mês com aporte previsto e ainda não feito, o Painel e Posições divergem. Sugestão: o Painel também usar só lançado, porque "aporte" é o que de fato foi feito.

## Nomes canônicos e linha de base (proposta, pt-BR)

Regra do glossário: **todo número monetário agregado leva o período no rótulo e uma linha de base que diga o que entra**. "Sobra" é sempre receita − despesa, sem aporte. "Comprometido" é sempre dinheiro de cartão a pagar. "Aporte" sozinho é sempre o lançado. O planejado é sempre "Aporte planejado".

| Onde | Hoje | Nome proposto | Linha de base proposta |
|---|---|---|---|
| Painel | Sobra do mês / Déficit do mês | **Sobra de outubro** / **Déficit de outubro** | "Competência out/26, em andamento: receitas de outubro e faturas que vencem em outubro · inclui R$ 766,09 previstos" |
| Investimentos | Sua sobra real (…) por mês | **Sobra média mensal** | "Média de jul/26 e set/26, meses fechados, só o que foi lançado · jul e set não têm receita lançada" (o aviso só quando for o caso) |
| Painel | Total comprometido (24 m) + Parcelas a vencer (24 m) | **Comprometido nos cartões** (card único, ver acima) | "Faturas de out/26 a set/28 · compras lançadas e parcelas" |
| Painel | Aportes | **Aportes de outubro** | "Competência out/26, lançados como aporte · R$ 0,00 de R$ 500,00 planejados" (a segunda parte só com plano) |
| Investimentos | Aporte mensal atual | **Aporte mensal planejado** | (dica do campo) "Quanto você pretende investir por mês. O que foi de fato aportado aparece em Posição real e aportes." |
| Posições | Aporte efetivo × planejado | **Aporte lançado × planejado** | sem mudança |

Mês por extenso no rótulo ("Sobra de outubro") e mês curto na base ("out/26"), pelo pt-BR que a crítica pediu no lugar de "10/2026". O rótulo fica curto, e a palavra "competência" vai sempre na linha de base. Alternativa mais literal para o Ricardo escolher: "Sobra da competência out/26".

## Decisões para o Ricardo
1. **Nomes:** aceitar a tabela acima, ou a alternativa literal com "competência" no rótulo.
2. **Card único de comprometimento:** juntar "Parcelas a vencer" e "Total comprometido" e tirar "Parcelas a vencer" do "Resumo do mês".
3. **Fatura vencida no comprometido:** o card soma a fatura da competência corrente mesmo depois do vencimento. O app não sabe se ela foi paga (`statements.status` nunca muda), mas sabe que venceu. Ela continua contando, ou sai depois do vencimento?
4. **Média de sobra:** só avisar quando um mês da média não tem receita, ou tirar esses meses da média.
5. **Aportes no Painel:** contar só o lançado (como Posições), ou continuar contando também o previsto.

## O que NÃO é proposto aqui
Cor, fonte, tamanho, espaçamento e composição ficam para o redesenho. Tudo acima é texto e estrutura (qual número fica em qual card), e sobrevive a ele.
