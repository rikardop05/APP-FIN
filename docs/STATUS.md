# STATUS — estado das tarefas

Mantido pelo orquestrador. Estados: `todo | doing | review | done | blocked`.
Primeiro arquivo a ler ao retomar uma sessão. Modelo por classe em `ORCHESTRATION.md` §9, equipe em `TEAM.md`.

**Última atualização:** 2026-09-24 · 591 testes verdes · HEAD `0554474`, sincronizado · **Fase 1 implementada por inteiro; só o aceite (T-116) falta**

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
| T-116 | Aceite de ponta a ponta da Fase 1 | — | **todo** | ⛔ **GATE HUMANO.** Exige validar os 3 parsers contra as faturas reais em `.private/` |
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
