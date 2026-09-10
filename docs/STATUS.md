# STATUS — estado das tarefas

Mantido pelo orquestrador. Uma linha por tarefa. Estados: `todo | doing | review | done | blocked`.
Primeiro arquivo a ler ao retomar uma sessão. Modelo por classe em `ORCHESTRATION.md` §9.

| ID | Tarefa | Classe | Modelo | Estado | Agente | Data | Nota |
|----|--------|--------|--------|--------|--------|------|------|
| T-001 | Bootstrap do projeto | I | Opus 5 | **done** | Bigorna | 2026-09-10 | commit 588289c. | 4 gates verdes + audit 0, validados pelo Orquestrador. Posse ratificada. `overrides` de postcss e esbuild zeraram 6 advisories sem sair do Next 15. Landing provisória em `app/page.tsx` |
| T-002 | Schema, migrations e seed | D | Opus 5 | **review (2a)** | Bigorna | 2026-09-10 | ⛔ **gate humano aberto** sobre `drizzle/0000_silent_zombie.sql`: 18 tabelas, 14 enums, 43 FKs, 4 checks, 2 uniques parciais, seed com 22 regras. **2b** aguarda `DATABASE_URL` |
| T-003 | Primitivos de dinheiro e data | P | Opus 5 | **done (aguarda commit)** | Prumo | 2026-09-10 | 102 testes, 4 gates verdes. Zero dependência: UTC + `Intl`, date-fns e date-fns-tz **não** entraram. 14 valores conferidos à mão pelo Orquestrador, fora da suíte |
| T-004 | Autenticação | I | Opus 5 | todo | Bigorna | — | |
| T-005 | Layout, navegação e formatação | U | Sonnet 5 | todo | Vitral (a recrutar) | — | |
| T-100 | Inventário de formatos por banco | I | DeepSeek V4 Flash | **done** | Enxada | 2026-09-10 | Tabela fechada e checklist §5 criado. Revisão do Orquestrador corrigiu 1 defeito: arquivo bruto ia para caminho versionado |
| T-121 | Detector de parcelas | P | Opus 5 | todo | Prumo | — | extraído do T-106 |

> Fases 1 a 4: copiar as linhas de `BUILD-PLAN.md` conforme cada fase começa.

## Decisões de escopo em vigor

| Decisão | Data | Efeito |
|---|---|---|
| **OFX adiado para a Fase 4** (T-106) | 2026-09-09 | **Nenhum dos três bancos oferece OFX** (verificado pelo humano). `detectInstallment` foi extraído para **T-121**, porque era do T-106 e é consumido por PDF, texto colado e pipeline. v1 fica com **dois caminhos**: PDF e texto colado. |
| **CSV e XLS/XLSX adiados para a Fase 4** (T-105, T-118, T-105a/b/c) | 2026-09-09 | v1 importa por **OFX, PDF do Nubank e texto colado**. `.csv`/`.xls`/`.xlsx` são recusados com orientação para colar o conteúdo. Toda a maquinaria de mapeamento de coluna (`ColumnMap`, `ImportMapping`, uso da tabela `import_mappings`) sai da v1. Criada **T-120** para dar dono aos tipos compartilhados que eram do T-105. |
| PDF do Nubank suportado (T-117) | 2026-09-09 | Camada de texto via `ToUnicode` CMap; offset chumbado proibido. |
| Texto colado como fallback universal (T-119) | 2026-09-09 | Nenhum banco fica sem caminho de entrada. Prioridade alta na Fase 1 — é o que cobre Santander e Mercado Pago. |
| Confirmação editável obrigatória (RF-IMP-02) | 2026-09-09 | Nada é gravado antes da confirmação; competência e hash recalculados sobre o que foi confirmado. |

## Sonda de PDF: executada e concluída (2026-09-10)

**Os três bancos têm camada de texto.** Nenhum exige OCR ou colagem manual. Detalhe em `IMPORT-SOURCES.md` §2.

| Banco | Cifrado | Camada de texto | Mecânica que o parser precisa |
|---|---|---|---|
| Nubank | não | 171 runs | subset Type0 → `ToUnicode` |
| Santander | RC4 | 884 runs | senha + **remontagem por coordenada** (1 de 884 linhas tinha data+valor juntos) |
| Mercado Pago | AES-256 | 456 `TJ`, 7 CMaps | senha + **decodificação CID** via `ToUnicode` |

**Consequências no plano:**

- T-117b (Santander) e T-117c (Mercado Pago) deixaram de ser condicionais: estão na v1.
- Novo requisito **RF-IMP-11**: campo de senha no upload, senha só em memória, nunca persistida nem logada.
- Novo requisito **RF-IMP-12**: remontagem de linha por coordenada, infra comum aos três parsers.
- Contrato de PDF reescrito em `CONTRACTS.md` §15: `extractPdfTextItems` (com coordenadas e senha), `groupIntoRows`, um parser por banco, `detectPdfIssuer`.
- Rotina mensal esperada: **subir três PDFs**, com senha em dois. Texto colado volta a ser rede de segurança.

**Cuidado com as fixtures:** os PDFs contêm nome completo, número parcial de cartão e endereço. Só entram no repo anonimizados (CONVENTIONS §9).

## Equipe no canvas (2026-09-10)

Distribuição completa, roles e comandos em `TEAM.md`.

| Codinome | Agente / modelo | Papel |
|---|---|---|
| Bigorna | `claude --model claude-opus-5` | infra, schema, auth |
| Prumo | `claude --model claude-opus-5` | motor puro e fórmulas |
| Vigia | Codex · gpt-5.6-sol | revisão, sem posse de arquivo |
| Enxada | `opencode -m opencode-go/deepseek-v4-flash` | trabalho mecânico, sem posse fixa |

## Próximo passo

**T-001 em execução pelo Bigorna** e **T-100 em execução pelo Enxada**, ambos desde 2026-09-10. É gate: ao terminar, o Orquestrador valida (build, lint, test, diff contra a posse) e reporta ao humano antes de liberar T-002.

Pendente do humano: **`DATABASE_URL`** de um Postgres free tier (Neon ou Supabase), para fechar a parte **2b** do T-002. Commit inicial feito em 2026-09-10 (`588289c`), então a auditoria de posse por `git diff` já funciona.

Requisito para entregar no gate do T-001: o `.gitignore` precisa conter **`.private/`** — é onde ficam os arquivos reais de banco, que nunca podem ser versionados (CONVENTIONS §9). Achado na revisão da entrega do T-100.
