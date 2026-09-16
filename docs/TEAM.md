# TEAM — distribuição de agentes no Maestri

Estado em **2026-09-16**. Atualizar quando a equipe mudar.

> ⚠️ **A equipe de 2026-09-10 (Bigorna, Prumo, Vigia, Enxada, Garimpo, Vitral) não existe mais.**
> O canvas foi esvaziado e reconstruído. Se um agente mandar mensagem para um desses nomes, ela não
> chega a ninguém. A fonte de verdade sobre quem está vivo é `maestri list`, nunca este arquivo.

---

## 1. Equipe ativa

| Codinome | Programa · modelo | Role | Posse exclusiva |
|---|---|---|---|
| **Claude Code** (eu) | Claude Code · Opus 5 | `Orquestrador` | `docs/`, e a ratificação de `lib/import/types.ts` |
| **Estaca** | OpenCode · `deepseek-v4.1-flash` | `Infra e Schema APPFIN` | `lib/db/`, `drizzle/`, `scripts/seed.ts`, `lib/auth/`, `app/(auth)/`, `app/api/auth/`, `middleware.ts` |
| **Esquadro** | OpenCode · `deepseek-v4.1-flash` | `Motor Financeiro APPFIN` | `lib/money/`, `lib/date/`, `lib/finance/` |
| **Peneira** | OpenCode · `deepseek-v4.1-flash` | `Importacao APPFIN` | `lib/import/pdf/**` |
| **Funil** | OpenCode · `deepseek-v4.1-flash` | `Importacao Texto APPFIN` | `lib/import/text.ts` **e mais nada** |
| **Lanterna** | Codex · `gpt-5.6-luna` | `Telas APPFIN` | `app/`, `components/`, `lib/db/queries/` |
| **Corvo** | OpenCode · `deepseek-v4.1-flash` | `Revisor APPFIN` | **nenhuma** — read-only |
| **Cinzel** | OpenCode · `deepseek-v4.1-flash` | `Git Manager APPFIN` | só commits |

Topologia: Bigorna e Prumo conectados a mim e ao Vigia. Vigia conectado aos dois.

```
                 Claude Code (Orquestrador)
                  /       |       \      \
            Bigorna     Prumo   Vigia   Enxada
                  \       /       /
                   `--- Vigia ---'
```

- Bigorna e Prumo pedem revisao direto ao Vigia, sem me atravessar.
- Enxada e ligado somente a mim: entrega rascunho, eu integro ou passo ao dono do arquivo.

## 2. Equipe completa desde 2026-09-10

Os seis recrutas estão no canvas. Não há mais ninguém a recrutar no plano: as classes P (motor e importação), D, A, U, revisão e trabalho mecânico estão todas cobertas, com posses disjuntas.

## 3. Por que essa divisão

1. **Posse de arquivo disjunta é o que sustenta o paralelismo.** Prumo e Garimpo são ambos classe P e rodam juntos porque `lib/finance/` e `lib/import/` não se cruzam. Antes de disparar agentes simultâneos, conferir que as listas de posse não se cruzam (`ORCHESTRATION.md` §4).
2. **Garimpo é separado do Prumo** por contexto técnico, não por volume: `pdfjs-dist`, CMaps `ToUnicode`, coordenadas de run de texto. Misturar isso com fórmula financeira polui os dois.
3. **Vitral acumula API e telas** porque T-108 (persistência) e T-111 (tela) são sequenciais no grafo — não há paralelismo a ganhar separando, e economiza um slot de terminal.
4. **Vigia não tem posse nenhuma.** Regra de `ORCHESTRATION.md` §7: revisor nunca é implementador. Roda em Codex de propósito: família de modelo diferente do implementador significa ponto cego diferente.

## 4. Modelo por agente: como é fixado

`maestri recruit --preset` escolhe o **programa**, não o modelo. O modelo é fixado no `--command`:

```bash
--command "claude --model claude-opus-5"     # Opus 5
--command "claude --model claude-sonnet-5"   # Sonnet 5
--preset "Codex"                             # codex, modelo default; /model dentro do terminal para trocar
```

A política de qual modelo em qual classe está em `ORCHESTRATION.md` §9. Resumo: modelo forte onde o erro é **silencioso** (fórmula financeira, schema, autenticação), modelo rápido onde o erro é **visível na hora** (tela).

## 5. OpenCode: instalado e utilizável

`opencode` 1.18.30 instalado (`npm i -g opencode-ai`), credencial **OpenCode Go**, 34 modelos. Verificado em 2026-09-10:

```bash
opencode run --model opencode-go/deepseek-v4-flash "..."   # respondeu
opencode -m opencode-go/deepseek-v4-flash                  # TUI aceita o mesmo flag
```

Recrutar um agente nesses modelos é uma linha:

```bash
maestri recruit "Enxada" --command "opencode -m opencode-go/deepseek-v4-flash" --role "Trabalho Mecanico APPFIN"
```

**Recrutado em 2026-09-10.** A role dele recusa explicitamente tarefa de `lib/finance/`, schema, auth, parser de PDF e revisão, e manda parar se conteúdo de fatura real aparecer no contexto.

**O catálogo não tem nenhum Claude** — só DeepSeek, GLM, Kimi, Qwen, MiniMax, Grok, Nemotron, gpt-5.6-luna. Então OpenCode não substitui Opus 5 nem Sonnet 5 onde a política de modelo (`ORCHESTRATION.md` §9) os exige; serve como **capacidade adicional e barata**, para outra classe de trabalho.

### Onde um modelo rápido e barato rende

| Serve | Por quê |
|---|---|
| Seed de dados: árvore de categorias pt-BR, 15–25 regras iniciais de categorização | volume mecânico, resultado conferível em segundos |
| Stubs de tela, `EmptyState`, componentes de UI simples, i18n e formatação | defeito visível na hora |
| T-100: catalogar formatos e preencher tabela de `IMPORT-SOURCES.md` | trabalho de registro, não de decisão |
| Rascunho de fixture **sintética** para teste de parser | dado inventado, sem risco |
| Varredura repetitiva: achar `number` decimal usado para dinheiro, `new Date()` dentro de `/lib` | padrão textual, alto volume |

### Onde não serve

| Não serve | Por quê |
|---|---|
| Qualquer coisa em `lib/finance/` (classe P) | erro de fórmula é silencioso e vira decisão financeira errada de 20 anos |
| Schema e migrations (T-002) | erro contamina as quatro fases |
| Autenticação (T-004) | superfície de segurança |
| Parsers de PDF (T-117, T-117b, T-117c) | decifragem, CMap `ToUnicode`, coordenadas — trabalho técnico denso, com pouco exemplo público |
| Revisão de entrega | revisor precisa ser mais forte que o implementador, não mais barato |

### Ressalva de privacidade — vale mais que a economia

`RNF-01` diz que dado financeiro não sai da aplicação. O OpenCode Go roteia para provedores de terceiros (DeepSeek e outros), uma cadeia diferente da que já é usada. Portanto: **um agente em OpenCode nunca recebe conteúdo de fatura real** — nem para "ajudar a anonimizar fixture". Anonimização de arquivo real fica com um agente Claude, ou com você. Para o agente barato, só entrada sintética ou já anonimizada.

## 6. Fluxo de trabalho

1. O Orquestrador delega com `maestri ask "Nome" "..."`, montando o prompt pelo template de `ORCHESTRATION.md` §3.
2. O implementador entrega e pede revisão ao Vigia por conta própria: `maestri ask "Vigia" "revise a entrega T-XXX: ..."`.
3. O Vigia responde achados; o implementador incorpora.
4. O implementador reporta ao Orquestrador, que **valida por si mesmo** (`ORCHESTRATION.md` §7): build, lint, testes, diff contra a posse declarada, assinaturas contra `CONTRACTS.md`.
5. Entrega reprovada volta para o **mesmo** agente, não para um novo.
6. Nos gates (T-001, T-002, T-116, T-208, T-301, T-306), o Orquestrador para e reporta ao humano.

Para disparar vários de uma vez: `maestri ask --batch '{"Bigorna": "...", "Prumo": "..."}'`.
