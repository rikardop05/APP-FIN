# STATUS — estado das tarefas

Mantido pelo orquestrador. Estados: `todo | doing | review | done | blocked`.
Primeiro arquivo a ler ao retomar uma sessão. Modelo por classe em `ORCHESTRATION.md` §9, equipe em `TEAM.md`.

**Última atualização:** 2026-09-16 · 326 testes verdes · HEAD `20baa59` · entregas em voo no working tree

## Tarefas

| ID | Tarefa | Agente | Estado | Nota |
|----|--------|--------|--------|------|
| T-001 | Bootstrap do projeto | Bigorna | **done** | commit `588289c`. Regra de camada no ESLint faz CONVENTIONS §5 falhar o lint de verdade |
| T-002a | Schema, migrations e seed (offline) | Bigorna | **done** | 18 tabelas, 14 enums, 43 FKs, 4 checks, 2 uniques parciais. Migration única, regenerada limpa |
| T-002b | Aplicar migration e provar seed idempotente | Estaca | doing | **Desbloqueado**: Neon provisionado, migration aplicada, 18 tabelas/14 enums/4 checks conferidos por query. Rodando o seed real |
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
| T-119 | Parser de texto colado | Funil | review | Em revisão do Corvo |
| T-107 | Pipeline de preview | Peneira | todo | Ganhou requisito novo: desempatar parcela × data pelo `occurredOn` da linha |
| T-117 | Extração de PDF + parser Nubank | Peneira | doing | `extract.ts` e `rows.ts` verdes. Layout do Nubank **medido em fatura real** e publicado anonimizado em `IMPORT-SOURCES.md` §6 |
| T-004 | Autenticação | — | todo | **Sem dono ativo.** `AUTH_ALLOWED_EMAILS` já preenchido |

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
- **O revisor não é mais de família de modelo diferente.** Corvo roda no mesmo DeepSeek dos implementadores, então a garantia de "ponto cego distinto" do `TEAM.md` §4 não vale; o role dele foi reescrito para exigir revisão por execução, e a validação final é sempre do Orquestrador.
