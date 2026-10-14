# Decisões tomadas pelo Orquestrador, a confirmar com o Ricardo

Quando o Ricardo não estava disponível, o Orquestrador escolheu pela melhor opção para o uso do projeto e o método do impeccable. Cada item diz **o que foi decidido**, **por quê** e **como reverter**. Ao confirmar ou mudar um item, mova-o para "Confirmadas" com a data.

## Abertas

| Data | Decisão | Por quê | Como reverter |
|---|---|---|---|
| 2026-10-09 | **Aportes do mês contam só o lançado**, com o planejado ao lado ("R$ X de R$ Y planejados"). | Bate com a tela de Posições e com o princípio "Números explícitos": previsto não se mistura com realizado. | Somar previstos em `monthlyKpis.contributionsCents` (lib/finance/kpis.ts). |
| 2026-10-08 | **Fluxo no menu primário do celular**, Importar em "Mais". | A importação é ritual de desktop; o Fluxo é consulta rápida no celular. | `mobile: 'primary'` em `components/nav/nav-items.ts`. |
| 2026-10-09 | **Carimbo de PAGO e CONFERE em verde**; vermelho só para perigo, erro e divergência. | O contrato se contradizia; verde evita ler "pago" como alarme. | Tom do `Carimbo` em `components/ui-kit/carimbo.tsx` e DESIGN.md. |
| 2026-10-09 | **"Faturas anteriores não pagas"** (por competência) no Comprometido; "Vencida" em Cartões continua por data de vencimento. | Toda fatura anterior sem marca de paga é dívida, vencida ou não; o alerta de vencida é mais estreito. | `futureCommitment`/`overdueUnpaid` em lib/finance e lib/db/queries/dashboard.ts. |
| 2026-10-14 | **Esqueleto de canhotos só onde vem lista; barras simples onde vem formulário.** | O esqueleto não deve prometer uma lista que não vem. | `SkeletonCanhotos`/`SkeletonBarras` no ui-kit. |
| 2026-10-14 | **Equipe:** Muse Spark 1.3 para implementação (Faisca, Crivo, Alicerce, Lume), GLM-5.3-Flash para telas com visão (Geleira), DeepSeek V4.1 Flash para revisão (Sonda). Segunda implementadora de telas (Lume) recrutada. | Teste comparativo de 2026-10-14 (docs/TEAM.md). | `maestri recruit --replace` com outro modelo. |
| 2026-10-14 | **Avaliações da crítica pela equipe OpenCode e pelo portal do Maestri**, com uma avaliadora temporária independente quando a revisora habitual já tinha visto o trabalho. | Regra "sem Claude além do Orquestrador, sem Chrome"; evitar ancoragem. | — |

## Confirmadas

| Data | Decisão |
|---|---|
| 2026-10-14 | Tema escuro padrão para todos; claro por escolha (decisão do Ricardo). |
| 2026-10-14 | Painel: o número calmo lidera; o aviso das faturas não pagas é faixa de atenção (decisão do Ricardo). |
