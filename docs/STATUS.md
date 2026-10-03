# STATUS — estado das tarefas

Mantido pelo orquestrador. Estados: `todo | doing | review | done | blocked`.
Primeiro arquivo a ler ao retomar uma sessão. Modelo por classe em `ORCHESTRATION.md` §9, equipe em `TEAM.md`.

**Última atualização:** 2026-10-01 · 891 testes verdes · HEAD `3d96f02`, sincronizado · **Fases 1 e 2 completas e aceitas. Fase 3 não começou.**

## Tarefas

| ID | Tarefa | Agente | Estado | Nota |
|----|--------|--------|--------|------|
| T-001 | Bootstrap do projeto | Bigorna | **done** | commit `588289c`. Regra de camada no ESLint faz CONVENTIONS §5 falhar o lint de verdade |
| T-002a | Schema, migrations e seed (offline) | Bigorna | **done** | 18 tabelas, 14 enums, 43 FKs, 4 checks, 2 uniques parciais. Migration única, regenerada limpa |
| T-002b | Aplicar migration e provar seed idempotente | Estaca | **done** | Migration aplicada (18 tabelas, 14 enums, 4 checks conferidos por query). Seed idempotente provado em 3 execuções. Check conta-XOR-cartão rejeitando |
| T-003 | Primitivos de dinheiro e data | Prumo | **done** | commit `e6cdefe`. Zero dependência: UTC + `Intl`. date-fns não entrou |
| T-005 | Layout, navegação e ui-kit | Vitral | **done** `f1d4d6a` | 9 rotas em 200, zero formatação monetária fora do `Money`. V-02 a V-09 corrigidos e conferidos pelo Orquestrador: colação pt-BR, painel `Mais` acessível, ação dos stubs dentro do shell |
| T-100 | Inventário de formatos por banco | Enxada | **done** | Sem OFX nos três bancos. Checklist de captura em `IMPORT-SOURCES.md` §5 |
| T-101 | Motor de faturas | Prumo | **done** `966fcdf` | Janelas pavimentam o calendário nas 8 configurações de fechamento, sem lacuna |
| T-102 | Parcelas | Prumo | **done** `966fcdf` | **F-01 corrigido**: `replanInstallments` perdia o saldo em silêncio; agora lança nomeando o valor |
| T-103 | Dedupe e normalização | Prumo | **done** `966fcdf` | F-04/F-05 em correção |
| T-104 | Categorização por regras | Prumo | **done** `966fcdf` | Ida e volta `suggestRulePattern` ↔ `matchRule` verificada |
| T-120 | Tipos e detecção de origem | Garimpo | **done** `4e8efc3` | Revisão sem nenhum achado. `ColumnMap`/`ImportMapping` corretamente omitidos (Fase 4) |
| T-121 | Detector de parcelas | Garimpo | **done** `4e8efc3` | F-02 e F-03 corrigidos. Tetos: **24** sem evidência, **99** com evidência escrita |
| T-110 | Comprometimento futuro | Esquadro | **done** | Validado pelo Orquestrador: 17 testes conferidos à mão, lint e typecheck limpos. Fixou a semântica de `lastCommittedCompetence` |
| T-112 | Tela de lançamentos | Lanterna | **done** | Verificado por imagem, desktop e 390px. Lote, filtro de não categorizados e `suggestRulePattern` exercitados. Dívida de UX mobile registrada |
| T-115 | Dashboard Fase 1 | Esquadro (cálculo) / Lanterna (tela) | **done** `0554474` | Horizonte lido do household, não fixo na tela |
| T-117b | Parser Santander | Peneira | **done** | 20 testes. `xBands` aplicado; ano resolvido por §8.2, regra não-posicional |
| T-117c | Parser Mercado Pago | Funil | **done** | 27 testes. Suposição de linha de continuação removida após medição |
| T-119 | Parser de texto colado | Funil | **done** | 36 testes |
| T-108 | Persistência da importação | Lanterna | **done** `fd32ac8` | Transação única com teste de rollback; dedupe provado de ponta a ponta |
| T-111 | Tela de importação e confirmação | Lanterna | **done** `499abb2` | Os 7 passos percorridos na tela real. Competência vem do servidor |
| T-113 | Comprometimento na tela de cartões | Lanterna | **done** `6546d37` | Verificado por imagem; mês positivo não desenha barra |
| T-114 | Categorias e regras em /config | Funil | **done** `d9b557e` | Os 2 critérios provados por execução; cadeia gravação→leitura→motor fechada |
| T-116 | Aceite de ponta a ponta da Fase 1 | Ricardo (gate) | **doing** | ⛔ **GATE HUMANO, em execução desde 2026-09-30.** As 3 faturas reais passaram pela tela. 4 defeitos achados, 3 corrigidos — ver §Gate abaixo |
| T-107 | Pipeline de preview | Peneira | **done** `14ccf3e` | Desempate parcela × data por `occurredOn`; invariante do summary como teste de propriedade |
| T-117 | Extração de PDF + parser Nubank | Peneira | **done** `73933d8` | Layout medido em fatura real (§6). `groupIntoRows` ganhou `xBands` para o caso do Santander |
| T-004 | Autenticação | Estaca | **done** | Login real fim a fim. Os 3 critérios provados: 307 verificado pelo Orquestrador, token gravado no banco, recusa fora da allowlist testada em 3 camadas com falha fechada |
| T-109 | Contas e cartões (CRUD + tela) | Lanterna | **done** | Verificado por **imagem**, desktop e 390px, nos dois estados. `householdId` é 1º parâmetro obrigatório nas 9 queries |

## Fase 2 — motores prontos

| ID | Tarefa | Estado |
|----|--------|--------|
| T-201 | Recorrência | **done** `8441dbc` — `dueDay` é a regra, `startsOn` é o piso |
| T-202 | Conciliação | **done** `4d14c49` — guloso sobre lista globalmente ordenada |
| T-203 | Orçamento | **done** `ba9f71a` — 4 limites exatos; ausência de despesa ≠ ausência de dado |

Faltam as telas: T-204 a T-208.

## Decisões tomadas pelo Orquestrador em 2026-09-24 (**todas revisáveis**)

O humano autorizou decidir sozinho o que fosse contido, marcando como revisável.

| Decisão | Onde | Por quê |
|---|---|---|
| `N/M` ambíguo **único** vira data, não parcela | `lib/import/text.ts` | errar para data custa um clique; errar para parcela projeta M meses de despesa inexistente |
| Horizonte lê `commitment_months` do household | T-115 | o SPEC tinha 12 e 24 para o mesmo conceito |
| Média de orçamento divide por **todos** os meses | `lib/finance/budget.ts` | ausência de despesa não é ausência de dado — IPVA sugeriria orçamento mensal do valor anual |
| `plannedCents = 0` → `usage: null` | `lib/finance/budget.ts` | "sem orçamento definido", não "estourou" |
| Critério de melhor par: valor → data → id | `CONTRACTS` §9 | soma ponderada é inexplicável quando o pareamento sai errado |

## Auditoria de contradição (2026-09-24)

O Corvo varreu os seis documentos e achou **17 contradições**, mais quatro categorias confirmadas
limpas (unidade de centavos, basis points, nulabilidade, ordenação). Relatório completo em
`.private/auditoria-contradicoes.md` — fora do repositório, porque é diagnóstico e não documentação.

**Três graves já corrigidas** (`bfc1aeb`): o `dedupeHash` que faria parcelas 3/10 e 4/10 colidirem e
sumirem como duplicata; o horizonte 12 × 24; e o sinal de `installment_plans.total_cents`.

**Restam 14 para triar**, a maioria em áreas de Fase 2 e 3 ainda não construídas. Quatro são de
posse e propriedade de arquivo, e valem uma passada junto com a dívida de `BUILD-PLAN` × roles.

## Decisões de escopo em vigor

| Decisão | Efeito |
|---|---|
| CSV, XLS/XLSX e OFX adiados para a Fase 4 | v1 importa por **PDF e texto colado**. Nenhum dos três bancos oferece OFX |
| PDF é o caminho principal | Os três têm camada de texto (sonda em `IMPORT-SOURCES.md` §2). Santander RC4, Mercado Pago AES-256 |
| Confirmação editável obrigatória | Nada é gravado antes de confirmar. Competência e hash recalculados sobre o confirmado |
| Teto de parcelas: 24 sem evidência, 99 com | Decisão do humano. Não rediscutir sem ele |
| `nature` pertence à folha, não à raiz | Uma raiz "Alimentação", com "Mercado" essencial e "Restaurantes" não essencial |
| `extractPdfTextItems` é **assíncrona** | O contrato exigia pdfjs-dist e declarava retorno síncrono — contradição. `groupIntoRows`, `parseNubankPdf` e `finalizeImport` seguem síncronas |
| `lastCommittedCompetence` = último mês **devedor** | `totalCents < 0`, nunca `!= 0`. Mês só de estorno não é comprometimento. "Mês que zera" é redação de UI, não semântica de dado |
| Equipe migrada para OpenCode + Codex | Decisão do humano em 2026-09-16. Nenhum Claude Code além do Orquestrador |

## Achados que mudaram o projeto

| Achado | Quem | Consequência |
|---|---|---|
| PDFs de Santander e MP estavam **cifrados**, não ilegíveis | orquestrador | Os três bancos entram por PDF. RF-IMP-11 (campo de senha) nasceu daí |
| Cada célula do PDF é um run posicionado: 884 runs, 1 linha completa | orquestrador | RF-IMP-12: remontagem de linha por coordenada, infra comum aos três parsers |
| `replanInstallments` perdia saldo em silêncio | Vigia | F-01. Era o único bloqueante da janela |
| Sem teto, `2/60` projetava 5 anos de despesa inexistente | Vigia | F-03, e a decisão de domínio dos dois tetos |
| Posse do T-005 não concedia os stubs que a Entrega pedia | Vigia | V-01. Contradição do plano; 8 tarefas iam colidir |
| Dois `next dev` faziam o gate de build alternar verde/vermelho | Prumo e Garimpo | Regra §4.2 do ORCHESTRATION |
| TUI caído faz `maestri ask` digitar o prompt no shell | orquestrador | Regra §4.3 |

## Pendências do humano

1. **Faturas de Santander e Mercado Pago** em `.private/`. Só o Nubank foi fornecido (2026-09-16). Sem elas, T-117b e T-117c ficam em suposição e o aceite do T-116 não fecha.
2. **Autorizar o primeiro push.** O remoto `origin` já está registrado (`github.com/rikardop05/APP-FIN`), mas nenhum push foi dado. Antes dele, conferir que `.private/` continua fora do índice.
3. **T-004 (autenticação) não tem dono.** É a última peça da Fase 0.

## Dívida registrada

- **Validação dos parsers contra fatura real fica no T-116.** O parser do Nubank foi construído sobre layout medido (`IMPORT-SOURCES.md` §6), mas com fixtures sintéticas. Santander e MP seguem sem medição.
- **Revisão de código aprovou, duas vezes, funcionalidade que não funcionava.** No T-004 o login
  nunca tinha rodado de ponta a ponta, com 405 testes verdes. No T-114 o diálogo "Nova regra" abria
  vazio — a condição de render usava o registro como flag, e em regra nova o registro é `null`, então
  **criar regra, que é a função central da tela, estava quebrado**. Nos dois casos o Orquestrador
  havia validado assinaturas, posse, Zod, ordenação e `householdId`, e dado OK.

  Nenhuma dessas conferências toca condição de render nem fluxo de navegação. **Revisão de código e
  execução verificam coisas diferentes**, e para tela a segunda não é opcional — quem achou os dois
  defeitos foi quem abriu a tela, não quem leu o diff.

  **Consequência para T-111 e T-115:** nenhuma tela é aceita sem alguém percorrer o caminho do
  usuário, incluindo os estados vazios e os diálogos de criação. "Compila, tipa e testa" não cobre
  isso.

- **Legibilidade a 390px do /config não foi verificada.** Os três prints de mobile do T-114 falharam
  (ver `ORCHESTRATION.md` §3.1, `portal resize` derruba a renderização). Os dois critérios de aceite
  estão provados por execução; o que falta é convenção de projeto. Vai junto na passada de UI/UX.

- **UX de mobile: o painel de filtros empurra a lista para fora da tela.** Em `/lancamentos` a 390px,
  os sete campos de filtro ocupam a viewport inteira — vê-se o fim do painel e **um** lançamento.
  Quem abre a tela no telefone rola sete campos antes da primeira transação. Isso inverte a
  prioridade: a ação comum é **olhar** os lançamentos; filtrar é exceção. No desktop não acontece,
  porque os filtros cabem em duas linhas. É defeito exclusivo do mobile, que é onde a família usa.
  Correção provável: colapsar os filtros em acordeão com resumo (`12 lançamentos · 2 filtros ativos`).
  **Decisão do humano em 2026-09-17: fica para uma passada dedicada de UI/UX**, com skill própria,
  junto com as demais telas. Não corrigir isoladamente — T-113, T-114 e T-115 tendem a copiar o
  mesmo padrão de cabeçalho, e a passada deve tratar todas de uma vez.

- **`BUILD-PLAN` e roles distribuem posse por eixos diferentes, e se contradizem.**
  O `BUILD-PLAN` declara posse **por tarefa** (`T-108` → `lib/db/queries/transactions.ts`); os roles
  declaram posse **por agente** (Telas → `app/`, `components/`, `lib/db/queries/`). Enquanto um
  agente tem uma tarefa só, as duas leituras coincidem. Quando tem várias tocando o mesmo diretório,
  divergem — e o agente não tem como saber qual vale.

  **Aconteceu duas vezes em 2026-09-17, nos dois sentidos:**
  - o plano **deu** ao agente de telas um arquivo que não é dele (`lib/finance/kpis.ts`, no T-115).
    Resolvido movendo o cálculo para o Esquadro, pela regra "tela não calcula";
  - o plano **pareceu tirar** do agente de telas um arquivo que já era dele
    (`lib/db/queries/transactions.ts`, listado no T-108 — que é tarefa do mesmo agente). Ele leu
    "outra tarefa" como "outro dono", parou e perguntou. Custou uma rodada.

  Nos dois casos o agente fez o certo ao parar. Mas a terceira vez vai acontecer, e pode cair num
  agente menos cuidadoso.

  **Correção:** a posse por agente (os roles) é a fonte de verdade; a lista do `BUILD-PLAN` é
  indicativa, e serve para dizer *quais arquivos a tarefa toca*, não *de quem eles são*. Vale
  escrever isso no cabeçalho do `BUILD-PLAN`, junto da nota que já existe lá sobre substituir stub
  não ser violação de posse. Enquanto não estiver escrito, a regra é: **divergiu, pergunte ao
  Orquestrador** — nunca deduza.

- **O vocabulário do domínio mora na camada de banco, e a dependência está invertida.**
  `TransactionKind` e `CategoryNature` são definidos em `lib/db/enums.ts`. A regra de pureza
  (CONVENTIONS §5, com ESLint que cobre inclusive os `.test.ts`) impede `lib/finance/` e
  `lib/import/` de importar de lá — **nem o tipo**. O resultado é que as camadas puras **redigitam**
  as uniões à mão, e nada detecta divergência: acrescentar um valor no enum do banco não quebra nada,
  e o KPI simplesmente deixa de cobrir o caso novo, em silêncio.
  Um teste de paridade não resolve, porque ele também cairia sob a regra de camada.
  **A correção é mover as uniões para um módulo puro compartilhado** (ex.: `lib/domain/enums.ts`),
  com `lib/db/enums.ts` importando dali para montar o `pgEnum`. Quem define o que é um "tipo de
  transação" é o domínio, não o Postgres. Com uma definição só, o drift fica impossível por
  construção, em vez de apenas detectável. Achado do Corvo e do Esquadro no T-115.
  **Não é urgente** — o schema está congelado e os enums estáveis — mas cruza a posse de dois
  agentes (`lib/db/` e as camadas puras), então precisa de janela própria.

- **O revisor não é mais de família de modelo diferente.** Corvo roda no mesmo DeepSeek dos implementadores, então a garantia de "ponto cego distinto" do `TEAM.md` §4 não vale; o role dele foi reescrito para exigir revisão por execução, e a validação final é sempre do Orquestrador.

## O que o gate humano do T-116 achou (2026-09-30)

As três faturas reais passaram pela tela de importação pela primeira vez. Quatro
defeitos, **nenhum deles visível nos 591 testes verdes**. Medições em
`IMPORT-SOURCES.md` §9.

| # | Defeito | Causa | Efeito | Estado |
|---|---|---|---|---|
| G-01 | Toda importação de PDF morria com 500 genérico | webpack do servidor empacotava `pdfjs-dist` sem emitir `pdf.worker.mjs` | nenhum PDF importava | **corrigido** `4ea732f` |
| G-02 | Crédito virou despesa | `moneyToken` só aceitava `-` U+002D; o Nubank usa `−` U+2212 na linha de transação | pagamento de R$ 1.208,96 entrou como despesa | **corrigido**, verificado na fatura real |
| G-03 | Fatura inteira na competência errada | `dd/MM` sem ano recebia o ano da fatura; a compra era da parcela 8/12, de 2025 | MP foi para 2026-12 | **corrigido**, verificado na fatura real |
| G-04 | Pagamento da fatura anterior entra como lançamento | nenhum parser reconhece a linha | dupla contagem quando o extrato da conta entrar (RF-CC-04) | **corrigido**, reconciliado contra o total impresso |

Fora da importação, o mesmo gate achou que o `/` servia a landing provisória do
T-001: `app/page.tsx` e `app/(app)/page.tsx` resolviam os dois para `/`, e o
dashboard do T-115 nunca tinha sido visto. Corrigido em `4e2e6ce`.

### A lição, que vale mais que os quatro defeitos

Os 591 testes eram verdes e as fixtures eram todas sintéticas — escritas pelo
mesmo entendimento que escreveu o parser. Uma fixture sintética prova que o
parser faz o que o autor quis; só o arquivo real prova o que o banco faz.

A medição anonimizada das §6/§7/§8, feita justamente para fechar essa distância,
registrou **posição e formato** — e não o repertório de caracteres (G-02) nem o
alcance das datas (G-03). Medir não basta: é preciso medir a dimensão certa, e a
dimensão errada não se anuncia.

### Uma contradição entre agentes, arbitrada

Esquadro excluiu U+2014 do `parseBRL` com argumento escrito; Peneira o incluiu na
lista dela, que roda antes e venceria em silêncio. Arbitrado a favor do Esquadro:
zero ocorrências nos três PDFs, e o token varre a linha inteira, prosa jurídica
inclusive. A causa — **duas listas da mesma coisa em dois arquivos** — foi
fechada: `lib/money` exporta `MINUS_DASH_CODE_POINTS` e o parser deriva dela.

É a mesma raiz do G-02: o `moneyToken` estava duplicado literalmente em três
layouts, e por isso o defeito nasceu em triplicata.

### A prova do G-04: as duas faturas fecham no centavo

Excluir a linha de pagamento não é preferência de leitura — é o que faz a fatura
bater com o total que ela mesma imprime:

| Fatura | Linhas sem o pagamento | Total impresso no PDF |
|---|---|---|
| Mercado Pago | 17 = **−R$ 1.469,01** | `R$ 1.469,01` |
| Nubank | 14 = **−R$ 1.074,82** | `R$ 1.074,82` |

Com a linha incluída, o MP dava −R$ 2.416,29 — fora por exatamente os R$ 947,28
do pagamento. O detector marcou as duas linhas certas e **nenhuma outra**.

Um achado lateral: os dois bancos imprimem o pagamento com sinais opostos. O
Nubank usa `−` e o Mercado Pago não imprime sinal nenhum, então a linha sai
`+120896` num e `−94728` no outro. Como ela chega desmarcada e `credit_card_payment`
fica fora de despesa e de receita (RC-03), o número não entra em conta nenhuma da
v1. Fica **registrado como dívida**: se algum dia a linha for aproveitada para o
histórico de pagamento de fatura, o sinal precisa ser uniformizado antes.

### Correção de um número que publiquei errado

O commit `d04b3ba` e a versão anterior deste arquivo diziam **633 testes**. São
**619**. Contei enquanto a Peneira editava a árvore, ou seja, medi um alvo em
movimento — a mesma classe das armadilhas de `ORCHESTRATION` §3.1. Contagem de
teste só vale com a árvore parada, e `git stash -u` é o jeito de garantir isso.

## Pendências abertas ao fim do T-116 (2026-09-30)

Os 4 defeitos do gate estão corrigidos e verificados por imagem em desktop e
402px. O que ficou em aberto:

| # | Pendência | Com quem |
|---|---|---|
| P-1 | **Limpar o banco da casa.** 56 lançamentos, 3 faturas, 6 lotes e 4 planos foram gravados pelos parsers defeituosos. Mais 6 cartões que ninguém cadastrou (`Importação QA` ×2, `T108` ×2, dois `Nubank`). SQL pronto, entregue ao Ricardo — o harness bloqueou a exclusão em massa do meu lado. | Ricardo |
| P-2 | **Reimportar as 3 faturas** depois da limpeza, com os parsers corrigidos. | Ricardo |
| P-3 | **Rodapé do preview:** a linha de pagamento conta em `rowsNew`, então o resumo pode dizer "15 novas" com 14 sendo gravadas. Certo pela invariante, possivelmente enganoso. Perguntei 3 vezes à Lanterna, sem resposta. | Lanterna |
| P-4 | **Sinal do pagamento diverge entre bancos.** Nubank imprime com `−`, Mercado Pago sem sinal, então a linha sai positiva num e negativa no outro. Não afeta a v1 (chega desmarcada, e RC-03 mantém fora de despesa e receita). Uniformizar antes de qualquer uso do valor. | — |
| P-5 | **Passada de UI/UX** com skill dedicada, adiada pelo Ricardo. Inclui a dívida mobile do T-112. | adiado |
| P-6 | **14 achados da auditoria de contradições** ainda por triar. | — |

### O que este gate custou em falso diagnóstico

Três vezes eu medi um alvo em movimento e cheguei a conclusão errada:

1. **"633 testes"** no commit `d04b3ba` e neste arquivo. Eram 619 — contei
   enquanto um agente editava a árvore.
2. **"O parser perdeu o número da parcela"** — o campo é `current`, não `number`.
   Erro do meu script de diagnóstico, não do parser.
3. **"Dessincronia entre DOM e React no select de cartão"** — quase virou tarefa
   despachada. O `400` estava certo: um agente desativou o cartão no meio do meu
   fluxo. Virou a regra `ORCHESTRATION` §4.2b.

Nos três casos o código estava certo e a medição estava errada. **A medição
precisa de tanto ceticismo quanto o código** — e a árvore precisa estar parada
antes de contar qualquer coisa.

## Triagem da auditoria de contradições (2026-09-30)

Os 21 achados de `.private/auditoria-contradicoes.md` foram percorridos um a um contra o estado
atual do repositório. **Oito já não existiam** — foram fechados pelo trabalho dos últimos dias sem
que ninguém marcasse. Os que ainda estavam de pé, e o que ficou decidido:

| # | Achado | Decisão |
|---|---|---|
| 5 | `targetPortfolio` com `withdrawalBp = 0` | passa a devolver `null`. O aceite do T-301 já exigia "não divide por zero", mas o tipo não deixava espaço para a resposta |
| 6 | §16 apontava para `/lib/import/finalize.ts` | arquivo que **nunca existiu**: `finalizeImport` mora em `pipeline.ts`, do T-107. O contrato mandava criar um arquivo sem dono |
| 7 | `budgetStatus` publicava 3 luzes com 1 limiar | as três faixas escritas no contrato, como o T-203 já as implementou: `warnBp` governa só verde→amarelo, vermelho é 100% fixo |
| 8 | `accumulationCurve.competenceOffset` sem âncora | `fromCompetence` vira parâmetro obrigatório. Offset sem âncora não significa nada, e a função é pura — não pode ler o relógio |
| 9 | sete `null` sem condição declarada | tabela dizendo quando cada um ocorre. `null` é "não existe resposta", nunca `NaN`, `Infinity` ou zero de mentira |
| 11 | "STATUS é o único doc que o orquestrador escreve" | nunca foi verdade. A posse de `docs/` inteira é dele; a regra real é a outra ponta — **nenhum agente escreve em `docs/`** |
| 12, 13, 14 | posses sobrepostas | ver abaixo |

### As posses que se sobrepunham

Três caminhos estavam na posse **exclusiva de dois agentes ao mesmo tempo** — contradição nos
próprios termos, e os três já vinham mordendo:

| Caminho | Fica com | Por quê |
|---|---|---|
| `lib/db/queries/` | Lanterna | consulta existe para alimentar tela; o schema é da Estaca |
| `app/(auth)/`, `app/api/auth/` | Estaca | autenticação é infraestrutura, não tela |
| `lib/import/pipeline.ts`, `installments.ts`, `detect.ts` | Peneira | não eram de **ninguém**, e eu vinha despachando trabalho neles o dia inteiro sem perceber |

A armadilha é posse por prefixo de diretório: `lib/db/` contém `lib/db/queries/`, e `app/` contém
`app/(auth)/`. Quando um agente possui a pasta e outro possui a subpasta, **os dois têm razão**.
Toda posse de diretório agora declara o que exclui.

### G-05 a G-08

| # | Defeito | Estado |
|---|---|---|
| G-05 | *não era defeito.* O `400 Conta ou cartão inválido` estava certo — um agente desativou o cartão no meio do meu fluxo | virou `ORCHESTRATION` §4.2b |
| G-06 | competência da **fatura** tirada de uma transação qualquer | **corrigido** `0612014` |
| G-07 | competência da **linha** derivada da data da compra, não da fatura | **corrigido** `0612014` |
| G-08 | Santander detectava **zero** parcelas: a coluna em `x=168` foi medida como "data auxiliar" e nunca lida | **corrigido** — 5 planos onde havia 0 |

## PARADA DA EQUIPE — assinatura sem saldo (2026-09-30)

`Upstream request failed: Insufficient account funds`. **Os seis agentes morreram de uma vez** —
não é um modelo, é a conta: testei o Corvo (DeepSeek) e a Lanterna (MiniMax) e os dois dão o mesmo
erro. Só o Orquestrador (Claude Code) continua.

A contingência que o Ricardo pré-autorizou em 2026-09-23 era Codex → OpenCode Go. Como é o próprio
OpenCode Go que acabou, **não há para onde migrar sem decisão dele**.

O T-204 estava com 2.255 linhas **só no disco, sem rastreio**, quando isso aconteceu. Commitado em
`b162ec8` marcado como entrega parcial — preservar trabalho verde é diferente de aceitá-lo.

## T-116: as três faturas fecham no centavo (verificado em 2026-09-30)

| Fatura | Gravadas | Soma | Total impresso | Competência | Planos |
|---|---|---|---|---|---|
| Nubank | 13 | −R$ 1.074,82 | −R$ 1.074,82 | `2026-09` | 4 |
| Santander | 23 | −R$ 2.874,49 | −R$ 2.874,49 | `2026-09` | 5 |
| Mercado Pago | 17 | −R$ 1.469,01 | −R$ 1.469,01 | `2026-07` | 2 |

Pagamento da fatura anterior desmarcado nas três; competência única e correta nas três; parcelas
detectadas e projetadas. **Isso é o motor, não o aceite.** O que falta para o T-116 fechar é o
Ricardo confirmar na tela e ver os números caírem no painel — a gravação de ponta a ponta com dado
real ainda não foi exercitada por ninguém.

Uma sobra: o Nubank tem duas linhas de `R$ 0,00` informativas que viram uma só pelo dedupe (mesma
data, mesmo valor, mesma descrição). Não afeta total nenhum, mas elas não deviam entrar. Perguntei à
Peneira e ela morreu antes de responder.

## DECISÃO PENDENTE — previsão de recorrência: linha ou derivada?

**Bloqueia T-205, T-207 e T-208.** O T-204 entregou as ocorrências calculadas **na tela**
(`recurring-screen.tsx` chama `expandRecurrence`), sem gravar nada: as únicas escritas são
`insert(incomes)` e `insert(recurringExpenses)`.

### Minha recomendação: **gravar como `planned`**

Não por preferência — porque **o sistema já faz exatamente isso para o caso irmão**:

```ts
// lib/db/queries/import.ts:409 — parcelas futuras de uma fatura importada
const status: TransactionStatus = projected ? 'planned' : 'posted';
```

Parcela futura e recorrência futura são a mesma coisa: obrigação conhecida que ainda não aconteceu.
Tratar uma como linha e a outra como cálculo de tela seria incoerência sem razão.

| | Gravar como `planned` | Derivar na leitura |
|---|---|---|
| `DATA-MODEL:123` | a coluna `status` **nomeia** "recorrência" | precisaria mudar o modelo |
| `RF-ORC-03` (conciliar previsto × realizado) | funciona: há linha com identidade para casar | impossível: não se concilia contra memória de navegador |
| Dashboard (T-115) | vê, porque lê `transactions` | não vê sem query nova |
| Fluxo de caixa (T-206) | consome direto | alguém tem de derivar no servidor de qualquer jeito |
| Precedente | **já é assim** para parcelas | seria a exceção |

**O único argumento contra é real:** estado duplicado diverge quando a regra muda — edite a despesa
e as 12 linhas ficam velhas. Mas esse problema já foi resolvido no projeto, para o mesmo caso:

> `replanInstallments` — *"ao editar um plano: preserva parcelas já realizadas, regenera as futuras"*
> (CONTRACTS §4)

A recorrência precisa do simétrico: ao editar a regra, preservar o que já foi conciliado e regerar
o futuro. É trabalho, não impedimento — e é trabalho que já tem desenho pronto para copiar.

**Se o Ricardo decidir derivar**, o `DATA-MODEL` muda e o `RF-ORC-03` precisa de outro mecanismo.
Essa é a parte que torna a escolha dele e não minha.

## Decisões do Ricardo em 2026-09-30, fim do dia

| # | Decisão | Consequência |
|---|---|---|
| 1 | **Previsão de recorrência vira linha `planned`** | segue o precedente de `import.ts:409`; destrava T-205, T-207 e T-208 |
| 2 | **Sem base de teste secundária** — um banco só, corrigindo o que aparecer | os testes de integração continuam apontando para a casa; household próprio + limpeza no fim viram **obrigatórios** em todo teste que toque banco |
| 3 | Seguir a ação recomendada no T-116 | reverter os lotes e reimportar com os parsers corrigidos |

### Sobre a decisão 2, e por que ela não é descuido

Os quatro testes de integração de `import.test.ts` carregam `.env.local` **sozinhos** (linhas 5-11)
e rodam contra o Neon da casa **desde o T-108** — não desde hoje, como eu cheguei a afirmar. O
argumento deles é correto: *"uma transação falsa prova que o callback foi chamado, não que o
PostgreSQL reverteu linhas já inseridas"*. Eles criam household próprio e apagam no fim; o banco foi
conferido e não há resíduo.

Com um banco só, a proteção deixa de ser infraestrutura e passa a ser **disciplina verificável**:
todo teste que toque banco cria o próprio household e o apaga, e a revisão confere isso. É mais
frágil que uma base descartável, e está registrado como tal.

### Seis frentes abertas

| Agente | Frente |
|---|---|
| Esquadro | o simétrico de `replanInstallments` para recorrência — 3 decisões de contrato pendentes comigo |
| Estaca | auditoria de schema: índice para o volume de `planned`, a ligação que o RF-ORC-03 exige, e o que impede duplicata |
| Lanterna | gravar as ocorrências previstas (plano antes de implementar) |
| Funil | `app/api/budgets/**` — a API do T-205 |
| Peneira | as linhas de `R$ 0,00`, e a pergunta maior: o dedupe funde duas linhas idênticas do **mesmo lote**? |
| Corvo | revisão adversarial de `7fca5d0..HEAD` |

## A terceira vez que um gate verde escondeu uma tela quebrada

`f2c9f02`. O Ricardo abriu a confirmação do Mercado Pago e viu **−R$ 2.416,29 com 17 linhas**,
dois números que não podem ser verdade juntos: 17 linhas somam −R$ 1.469,01.

A tela não mandava `statementCompetence` no corpo do recálculo, e o schema — mexido horas antes,
na fiação do G-06/G-07 — passou a exigi-lo. Todo recálculo voltava `400`, e o total caía para uma
soma de reserva que ignora quais linhas estão marcadas.

| # | O que passou verde | O que estava quebrado |
|---|---|---|
| T-004 | 405 testes | o login não funcionava de ponta a ponta |
| G-01 | 591 testes | nenhum PDF importava: o worker do pdfjs não era emitido |
| este | 703 testes | o corpo da requisição não batia com o schema da rota |

**Sempre a mesma forma: duas pontas de um contrato que nenhuma ferramenta compara.** O `tsc` não
confere `JSON.stringify` contra Zod; o teste unitário não abre o navegador. Os 9 testes de
fronteira que entraram com o conserto montam o corpo exatamente como a tela monta e o validam
contra o schema real — é barato, e devia existir para toda rota que a tela chama.

### E uma correção que eu recusei

O primeiro conserto afrouxava o schema para `.nullable().optional()`, justificado como "defesa em
profundidade: um caller que esquecer cai no comportamento natural". É o oposto. Com o campo
obrigatório, quem esquece recebe `400` — barulhento, um minuto de conserto, e foi assim que achamos
este bug. Com ele opcional, o pipeline cai em `competenceFor(occurredOn)`, que é **literalmente o
G-07 corrigido horas antes**: a parcela 11/12 voltaria para 2025-11 em silêncio, com um número
plausível e errado na tela da família.

**Falta de informação obrigatória tem de falhar alto.**

---

# RETOMADA — leia isto primeiro (2026-10-03)

## Onde o projeto está

**Fase 1 aceita.** **Fase 2 vista de verdade em 2026-10-02** (o "vista" de 10-01 estava errado: as
agentes nunca tinham renderizado /orcamento nem /fluxo). Abrir as telas achou a categoria da despesa
fixa sempre vazia, jargão de código nos formulários e um diálogo de exclusão que mentia.

**Decisão nº 7 resolvida (opção b):** previsão cumprida vira `status = 'reconciled'`, com
`reconciled_by_transaction_id` (FK RESTRICT). A importação concilia (10 %, 5 dias; receita pela
conta). Contrato em `CONTRACTS` §9.

**Fase 3 completa e com gate humano aprovado** (2026-10-02): motor de investimento (T-301, Opus,
tabela de cenários conferida pelo Ricardo em planilha), API, planejador, "cabe na sua sobra?",
metas/reserva e card no painel. O Ricardo criou o plano real.

**Fase 4 em andamento:** T-402 backup (feito), T-403 PWA (feito, verificado em build de produção),
T-404 posições reais (em andamento; contrato em `.notas/contrato-t404.md`, decisões do Orquestrador
pendentes de ratificação).

1.229 testes, `tsc` e lint em zero. Migrations até **0008 aplicadas**.

## Decisões de 2026-10-02/03 que valem para todo código novo

- **Status que contam como dinheiro:** `COUNTED_STATUSES = ['posted','planned']`
  (`lib/db/queries/counted-statuses.ts`), lista POSITIVA: status novo fica fora por omissão.
- **Médias de histórico (sobra real, despesa essencial):** só `posted`, 3 meses fechados antes do
  corrente, mês sem lançamento não entra no divisor.
- **Saldo de abertura da conta é de INÍCIO do dia:** movimento `>= opening_date` entra; anterior fica fora.
- **Sinal:** Despesa e Receita digitadas positivas, o sinal vem do tipo (`manual-sign.ts`).
- **Um plano de investimento e uma reserva de emergência por household** (índices 0007, 0008).

## O que fazer ao retomar, em ordem

1. Ler `.notas/RETOMAR-AQUI.md` (o mapa curto do último dia).
2. **Conferir quem está vivo:** `maestri list` e um "Responda apenas: vivo." em cada um.
   Esquadro e Prisma rodam **Opus**; Trena Sonnet; os outros OpenCode (DeepSeek).
3. Delegar SEMPRE pelas agentes do canvas (decisão do Ricardo), com briefing em arquivo.

## Produção (ainda não existe)

`next build` passa. Para subir de verdade falta **SMTP real** (`EMAIL_SERVER`, `EMAIL_FROM`): sem
ele o Auth.js recusa subir em produção, por desenho (T-004), e toda rota com sessão responde 500.

## O que NÃO redescobrir

| Armadilha | Onde está escrito |
|---|---|
| Gate verde não prova que funciona — **seis** entregas passaram com `tsc` e testes limpos e estavam quebradas na tela | abaixo |
| `next dev` briga com `next build`, com o `.next`, e **com o humano usando a tela** | `ORCHESTRATION` §4.2 |
| Agente não escreve no banco da casa | `ORCHESTRATION` §4.2b |
| `git stash` com agente escrevendo apaga trabalho | `ORCHESTRATION` §4.2c |
| Espelho de enum só onde a camada proíbe o import | `CONVENTIONS` §5 |
| Medir árvore em movimento produz conclusão errada — **aconteceu sete vezes** | abaixo |

## As vezes que um gate verde escondeu uma tela quebrada

| # | Passou verde com | Estava quebrado |
|---|---|---|
| T-004 | 405 testes | o login não funcionava de ponta a ponta |
| G-01 | 591 testes | nenhum PDF importava: o worker do pdfjs não era emitido |
| `f2c9f02` | 703 testes | o corpo da requisição não batia com o schema da rota |
| aviso de vencimento | 837 testes | o Zod do cliente **descartava** o campo: o aviso nunca dispararia |
| `6ae4eda` | 891 testes | a categoria da despesa fixa vinha **sempre vazia**: a página filtrava como lista o que a query devolve como árvore |
| `8067aca` | 1.171 testes | o planejador gravava, mas não dizia; o Ricardo leu "não salvou" |

As três primeiras são duas pontas de um contrato que nenhuma ferramenta compara. A quarta é pior:
nem quebra, só some. A defesa que existe hoje são os **testes de fronteira**
(`app/api/import/recalculate/body-shape.test.ts`) — monte o corpo como a tela monta, valide contra o
schema real. Copie o padrão para toda rota nova.

## Estado do ambiente

- `next dev` na porta **3000**, iniciado por mim, logando em `.private/dev-server.log`. Pode ter
  morrido; `npm run dev -- -p 3000` o traz de volta. Mate qualquer outro antes (§4.2).
- O banco tem **dado real da família**: 3 cartões, 1 conta, e as faturas de Nubank (09/2026),
  Santander (09/2026) e Mercado Pago (07/2026). Não é base de teste — §4.2b.
- `.notas/` é correspondência com agentes, gitignorada e descartável.
