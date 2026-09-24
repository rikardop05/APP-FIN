# ORCHESTRATION — instruções para o orquestrador

> Destinatário: o agente orquestrador (Opus 5) rodando no Claude Code em `E:\APPFIN`.
> Você **planeja, delega e valida**. Você não escreve código de feature.

---

## 1. Ordem de leitura

| Momento | Ler |
|---------|-----|
| No início da sessão | este arquivo + `BUILD-PLAN.md` |
| Antes de delegar uma tarefa | a linha da tarefa no BUILD-PLAN + as seções de `CONTRACTS.md` que ela implementa |
| Antes de qualquer tarefa de importação | `IMPORT-SOURCES.md` |
| Quando houver dúvida de produto | `SPEC.md` |
| Nunca inteiro por padrão | `DATA-MODEL.md` (só a tabela em questão) |

## 2. O que vai no contexto de cada agente

Sempre, para todo agente que escreve código:

1. `CONVENTIONS.md` — **integral, sem resumir**.
2. A linha da tarefa no BUILD-PLAN (objetivo, posse, aceite).
3. Apenas as seções de `CONTRACTS.md` que a tarefa implementa ou consome.
4. Apenas as tabelas de `DATA-MODEL.md` que a tarefa toca.
5. A tabela de defaults (§5 deste arquivo).

Nunca mande o pacote inteiro de docs: contexto inflado é a causa mais comum de agente que inventa fora do contrato.

## 3. Template de delegação

```
TAREFA: <ID> — <título>
TIPO: <P | D | A | U | I>

OBJETIVO
<colar "Entrega" da linha do BUILD-PLAN>

CONTRATO
<colar as assinaturas exatas de CONTRACTS.md — implemente exatamente estas>

SCHEMA
<colar apenas as tabelas relevantes de DATA-MODEL.md>

POSSE DE ARQUIVOS (exclusiva)
<lista de caminhos>
Você NÃO edita nada fora desta lista. Precisou de algo fora? PARE e reporte.

CONVENÇÕES
<colar CONVENTIONS.md integral>

DEFAULTS PARA AMBIGUIDADE
<colar §5>

CRITÉRIOS DE ACEITE
<colar "Aceite" da linha do BUILD-PLAN>

DEFINIÇÃO DE PRONTO
- `npm run build` sem erro de tipo
- `npm run lint` sem erro
- `npm test` verde, incluindo os casos de borda listados no aceite
- nenhum arquivo tocado fora da posse
- relatório final: o que fez, decisões tomadas, o que ficou de fora, dependência nova instalada (se houver)

NÃO FAÇA
- não altere /docs
- não altere assinatura declarada no contrato
- não instale biblioteca fora da lista aprovada sem registrar o motivo
- não marque como pronto com teste vermelho
- não "melhore" o escopo: entregue esta tarefa
```

## 3.1 Armadilhas de ferramenta já pagas

Cada uma destas custou pelo menos uma rodada. Registradas para não custarem de novo.

| Sintoma | Causa | O que fazer |
|---|---|---|
| `maestri ask` digita o prompt no PowerShell, linha a linha, virando `CommandNotFoundException` | TUI do agente não subiu ainda | Dar tempo de boot antes do primeiro `ask`. Com Codex, o modelo se fixa no `--command` do recruit (`codex -m <modelo>`); um `--replace` só com `--preset` volta ao modelo padrão |
| `maestri portal screenshot` não produz arquivo | **A janela do Maestri estava minimizada** — o portal não renderiza, então não há imagem | Pedir ao humano que restaure a janela. Depois: capturar e copiar **na mesma sequência**, porque o caminho devolvido é temporário e expira |
| `portal snapshot` não serve para conferir tela | Ele devolve **árvore de acessibilidade em texto**, não imagem | Para imagem é `portal screenshot` |
| Hydration mismatch cujo diff é `data-mref="..."` | **Ruído do próprio portal**, que injeta esses atributos para referenciar elementos (`mref` = maestri ref). Não existe no código nem no bundle | **Ignorar.** Qualquer outro diff de hydration é real e deve ser investigado |
| Varredura em `app/` volta vazia e a conclusão fica errada | Glob de **PowerShell não casa `(app)` nem `[id]`** — parênteses e colchetes são sintaxe de wildcard. Falha **em silêncio**, sem erro | Usar `bash`/`grep -r` para varrer `app/`, ou `-LiteralPath`. Já produziu dois falsos negativos: "rotas `[id]` sem `requireSession`" e "nenhuma causa de hydration" |
| Overlay do Next acusa `Runtime Error / JavaScript execution timed out after 10s`, em `<anonymous>`, sem arquivo nem componente | Instrumentação do portal, não o app. Verificado: `load` está em `useCallback([])` (sem loop de render), `/login` aberto em Chrome comum tem console 100% limpo, e o mesmo travamento ocorreu em `/login`, que não tem nada da tela de cartões | Ignorar dentro do portal. **Reconferir no T-116**, abrindo o app em navegador normal |
| Agente fica calado, o terminal mostra só a linha de lançamento e o TUI nunca aparece; `maestri ask` não produz nem eco no shell | **Boot travado ao retomar sessão pesada.** O OpenCode relança com `-s ses_...` para continuar de onde parou; quando aquela sessão está grande (o Esquadro estava em 42% de contexto), o boot pende indefinidamente. Indistinguível de "agente pensando" | Reiniciar com sessão limpa: `maestri recruit "<Nome>" --command "opencode -m <modelo>" --replace "<Nome>"` (sem `-s`). Sondar com um `ask` trivial **antes** de despachar tarefa. O contexto se perde, então reenviar a tarefa inteira |
| Agente volta com o prompt vazio, sem lembrar da tarefa, e nada foi escrito | **O terminal reiniciou** — o Codex se atualizou sozinho (0.154.0 → 0.156.1 em 2026-09-23) e o contexto foi zerado. Não é bloqueio nem recusa | Reenviar a tarefa **inteira**, incluindo decisões já tomadas na conversa perdida. E a regra que isso impõe: **o que precisa sobreviver a um reinício vai no role ou nos docs, nunca só numa mensagem** |
| Entrega de agente volta pela metade, sem aviso | Pedido com **várias etapas encadeadas**. A última some silenciosamente | Um objetivo por mensagem. Vale especialmente para o Git Manager e para tarefas de captura |

> **O denominador comum das três armadilhas de terminal.** Reinício por atualização de CLI, boot
> travado ao retomar sessão pesada e entrega parcial silenciosa produzem **o mesmo sintoma**: o
> agente fica calado. Silêncio não distingue "trabalhando", "travado" e "morreu" — e as três
> aconteceram no mesmo dia, 2026-09-23, custando quatro rodadas.
>
> A contramedida é uma só: **nunca inferir progresso do silêncio.** Verificar o artefato — o arquivo
> em disco, a saída de `git status`, o teste rodando — e não o relatório nem a ausência dele. Quando
> um agente passa tempo demais mudo, sondar com um `ask` trivial antes de supor qualquer coisa.
>
> Corolário que já se pagou duas vezes: **o que precisa sobreviver a um reinício vai no role ou nos
> docs, nunca só numa mensagem.** Contexto de conversa evapora; role e `docs/` são recarregados.

## 4. Regras de paralelismo

1. **Posse exclusiva é a regra que sustenta tudo.** Antes de disparar agentes simultâneos, confira que as listas de posse não se cruzam. Se cruzarem, serialize.
2. `lib/db/schema.ts`, `package.json` e `app/(app)/layout.tsx` são **arquivos de contenção**: só um agente por vez, nunca em janela paralela.
3. Respeite as janelas do mapa de paralelismo (BUILD-PLAN, final). Máximo de 6 agentes simultâneos; fora das janelas, 2 a 3.
4. Tarefas **P** (puras) são as melhores candidatas a paralelo: sem I/O, sem estado, sem conflito.
5. Tarefas **U** que compartilham `components/dashboard/**` são serializadas — é o segundo ponto de contenção do projeto.

### 4.1 Manifesto de dependências: posse serial compartilhada

`package.json` e `package-lock.json` não pertencem a uma tarefa só, e listar o manifesto na posse de cada tarefa que instala algo apenas duplicaria a lista. A regra:

1. **Qualquer tarefa pode acrescentar ao manifesto as dependências que a sua própria linha do BUILD-PLAN declara** — e só essas. Instalar biblioteca de outra tarefa é violação de escopo, mesmo que o arquivo seja "compartilhado".
2. **Uma tarefa por vez.** O manifesto é arquivo de contenção (§4, item 2): nunca em janela paralela. O orquestrador serializa.
3. **Remover ou trocar versão de dependência de outra tarefa é proibido.** Se houver conflito de versão, PARE e reporte — quem resolve é o orquestrador.
4. O diff do manifesto entra na validação de §7: se apareceu pacote que a linha da tarefa não pedia, a entrega é reprovada.

Registrado em 2026-09-10, no gate do T-001: o Vigia apontou, com razão, que §4 tratava concorrência mas não posse, e sem isso o T-002 não poderia instalar o Drizzle sem violar a posse na letra.

### 4.2 `next dev` é exclusivo e nunca fica rodando

Descoberto em produção em 2026-09-10, reportado independentemente por dois agentes: `next dev` **reescreve `.next/`** enquanto `next build` lê o mesmo diretório. Com um dev server no ar, o gate de build alterna verde e vermelho **com código idêntico** (`PageNotFoundError` no collect page data) — para todos os agentes, não só para quem subiu o servidor.

Regras:

1. **Um `next dev` por vez no repositório**, e só enquanto estiver sendo olhado. Terminou de conferir? Mate o processo.
2. **Porta explícita** (`next dev -p 32xx`). Sem isso o Next escolhe outra porta em silêncio quando a 3000 está ocupada, e você acaba testando contra o servidor de outro agente, com estado de compilação obsoleto. Foi o que aconteceu: quatro rotas apareceram como 500 e estavam íntegras.
3. **Gate de build vermelho com dev no ar não é reprovação.** Antes de reprovar entrega por build, confira que não há servidor de ninguém no ar: `netstat -ano | grep LISTENING` nas portas 30xx/32xx.
4. Quem sobe, derruba. Não deixe para depois.

### 4.3 Verifique se o agente está vivo antes de mandar prompt

Aprendido em 2026-09-10, duas vezes: o TUI de um recruta pode sair e deixar o terminal num shell puro. Nesse estado, o texto de `maestri ask` **é digitado no shell**, e cada linha do prompt vira tentativa de comando. Na primeira vez, um pedido de revisão de 30 linhas virou 30 erros de `CommandNotFoundException` no PowerShell do Vigia — inofensivo por sorte, mas é execução de texto arbitrário num shell.

Regras:

1. **Antes de um prompt longo, teste com um curto**: `maestri ask "Nome" "Responda apenas: vivo."`. Se voltar saída de shell em vez de resposta do agente, religue o processo antes de qualquer coisa.
2. **Prompt longo em TUI é frágil.** Prefira apontar para arquivos do repositório — o agente lê — em vez de despejar conteúdo no terminal. Menos texto digitado, menos chance de o TUI interpretar algo como atalho.
3. **Se um agente sair duas vezes**, não insista: troque o programa com `maestri recruit --replace`, que preserva o nó, as conexões e a posição no canvas.
4. Agente que reporta "não consegui alcançar o colega" está certo em parar e avisar, e errado em relançar o processo alheio por conta própria.

### 4.4 Laudo de revisão vai para nota ou para o implementador, nunca só para o terminal

O terminal de um agente mostra só a última tela: `maestri check` trunca, e um laudo de revisão longo **se perde** minutos depois de ser produzido. Em 2026-09-10 isso custou quatro rodadas para recuperar cinco achados que já existiam.

Como pedir revisão, daqui em diante:

1. **O laudo vai direto ao implementador**, pelo canal: `maestri ask "<Implementador>" "<texto integral>"`. Quem corrige precisa do texto inteiro, não do resumo.
2. **E fica gravado numa nota do canvas**: `maestri note create` com nome estável, uma seção por achado (id, severidade, arquivo, linha, cenário de falha, correção proposta). O orquestrador lê com `maestri note read` quando quiser, sem depender de scrollback.
3. Nota não é arquivo do repositório, então isso não fere a regra de o revisor nunca editar arquivo.
4. **O orquestrador não fica esperando o laudo para verificar.** Enquanto o revisor trabalha, sonde os invariantes por conta própria: conservação de valor, janelas que pavimentam o calendário, overflow, ida e volta de normalização. Achado que você confirma sozinho não depende de canal nenhum.

## 5. Defaults para ambiguidade — um agente nunca trava

Se a decisão está nesta tabela, aplique o default e siga. Se não está, pare e reporte ao orquestrador; o orquestrador decide ou eleva ao humano.

| Dúvida | Default |
|--------|---------|
| Idioma de identificador novo | inglês (CONVENTIONS §1) |
| Novo campo monetário | `bigint`, sufixo `_cents` |
| Novo campo percentual | `integer`, sufixo `_bp` |
| Arredondamento de divisão de valor | `allocate()`, resto nas primeiras parcelas |
| Fuso de exibição | `America/Sao_Paulo` |
| Transação sem categoria | permitido (`category_id` null) e aparece na fila de pendências |
| Transação sem membro | permitido; consolidado é o padrão, `member_id` é opcional |
| Pagamento de fatura | `kind = 'credit_card_payment'`, fora da despesa do mês |
| Aporte | `kind = 'investment_contribution'`, fora da despesa, dentro do fluxo de caixa |
| Onde entra receita variável (13º, PLR, bônus) | `incomes.frequency = 'one_off'` + `one_off_competence` |
| Posição real de investimento | **fora do escopo até T-404**; Fase 3 só planeja |
| Rateio de despesa entre cônjuges | fora de escopo; caixa é único |
| Multi-moeda | fora de escopo; BRL apenas |
| Fatura com total divergente | importa e **sinaliza**; nunca bloqueia a importação |
| Linha de arquivo corrompida | vira `diagnostic`, não aborta o arquivo |
| Duas transações idênticas no mesmo dia | tratadas como duplicata por default, com opção de forçar na UI |
| Banco não reconhecido na importação | cai no mapeador manual (T-401); até lá, reporta "formato não suportado" |
| PDF de fatura | suportado para **Nubank** (T-117), via camada de texto e `ToUnicode` CMap. Outros bancos: CSV/XLSX ou texto colado |
| Banco novo, formato desconhecido | não escrever parser por suposição: registrar em `IMPORT-SOURCES.md` e pedir fixture |
| Arquivo `.ofx`, `.csv`, `.xls` ou `.xlsx` na v1 | recusar com orientação para colar o conteúdo no card de texto. **Não implementar `parseOfx`, `parseCsv` nem `parseXlsx`** — T-106, T-105 e T-118 são Fase 4 |
| Extração de texto de PDF | sempre via **`pdfjs-dist`**. Extrator artesanal de stream é **proibido**, e offset de glifo chumbado no código também |
| PDF cifrado (Santander RC4, Mercado Pago AES-256) | campo de senha no upload. Senha **em memória apenas**: nunca em banco, cookie, `localStorage`, log ou mensagem de erro. Não "guardar para facilitar" — é proibido, mesmo se parecer conveniente |
| PDF cifrado sem senha | erro pedindo a senha. **Nunca** classificar como "sem camada de texto" nem cair no texto colado sem antes pedir a senha |
| Linha de PDF que não tem data+valor juntos | esperado: o PDF emite células como runs separados. Usar `groupIntoRows` (coordenadas), **nunca** a ordem do stream |
| Texto de PDF sai como lixo/acentuação errada | fonte CID ou subset: decodificar pelo `ToUnicode` CMap do arquivo. **Nunca** compensar com offset fixo nem tabela de substituição |
| `ColumnMap` / `ImportMapping` / tabela `import_mappings` | maquinaria de mapeamento de coluna: **Fase 4**. A tabela existe no schema, mas nenhum código da v1 a lê ou escreve |
| Tipos de importação (`ParsedRow`, `ParseResult`, `ParseDiagnostic`) | pertencem a T-120. Nenhum parser declara os seus próprios |
| PDF sem camada de texto | cai no **texto colado** (T-119): o usuário converte por fora e cola. OCR dentro do app continua fora de escopo |
| Teto de parcelas na detecção | 99 com evidência escrita (`PARC`, `PARCELA`, `N de M`), **24 sem evidência**. Decisão do humano em 2026-09-10; não rediscutir sem ele |
| Constante de domínio lida por dois módulos | nomear e alinhar explicitamente entre eles (ex: `MAX_TOTAL` ↔ `MAX_INSTALLMENT_COUNT`). Dois módulos divergindo ao ler a mesma string é bug caro de achar |
| Linha colada que o parser não entendeu | **nunca descartar**: devolver com `confidence: 'low'`, `missing` e `sourceLine`, editável na confirmação |
| O que é gravado numa importação | a **linha confirmada pelo usuário**, não a linha lida. Competência e `dedupe_hash` recalculados após a edição (RF-IMP-09) |
| Gravar direto, sem confirmação | **proibido** em qualquer caminho de importação (RF-IMP-02) |
| Erro inesperado em rota de API | 500 com mensagem pt-BR genérica; detalhe só no log do servidor |
| Estado vazio de tela | `EmptyState` com ação primária, nunca tabela vazia sem explicação |

## 6. Gates de revisão humana

O orquestrador **para e reporta** ao humano em: **T-001**, **T-002**, **T-116**, **T-208**, **T-301**, **T-306**. T-100 deixou de ser gate quando o CSV foi adiado; a sonda de PDF do T-117 já foi executada (`IMPORT-SOURCES.md` §2).

Formato do report de gate:
1. o que foi entregue desde o gate anterior (por ID de tarefa);
2. o que o humano precisa conferir com os próprios olhos (ex: em T-301, a tabela de cenários contra uma planilha);
3. decisões tomadas por default que valem confirmação;
4. o que vem em seguida e quantos agentes.

## 7. Validação antes de aceitar entrega de agente

Não aceite pelo relatório do agente. Verifique:

1. `npm run build`, `npm run lint`, `npm test` — os três, você mesmo.
2. `git status` / diff: nenhum arquivo fora da posse declarada.
3. Assinaturas: confira contra `CONTRACTS.md`, nome por nome.
4. Em tarefa **P**: leia os testes. Teste cujo valor esperado foi copiado da saída da implementação não prova nada — rejeite e peça valor conferido à mão.
5. Em tarefa financeira: confira um número à mão.

Entrega reprovada volta para o **mesmo** agente com o defeito apontado, não para um novo.

## 8. Bloqueio

Quando um agente reporta bloqueio: não delegue de novo o mesmo escopo esperando sorte diferente. Classifique:

- **contrato insuficiente** → o orquestrador atualiza `CONTRACTS.md` (única exceção à regra de não editar docs), avisa o humano e redelega;
- **decisão de produto** → consulte §5; se não estiver lá, eleve ao humano;
- **falha de ambiente/dependência** → resolva você mesmo antes de redelegar;
- **tarefa grande demais** → quebre em subtarefas com posses disjuntas e registre a quebra no BUILD-PLAN.

## 9. Atribuição de modelo por classe de tarefa

Definido. O critério: onde o erro é **silencioso** (fórmula financeira, schema, segurança) vai o modelo mais forte; onde o erro é **visível na hora** (tela) vai o modelo mais rápido.

| Classe | Tarefas | Modelo |
|--------|---------|--------|
| Orquestração | — | **Opus 5** |
| **P** — motor puro e fórmulas | T-003, T-101…T-104, T-107, T-110, T-117, T-117b, T-117c, T-119…T-121, T-201…T-203, T-206, T-301 | **Opus 5** |
| **D** — schema e migrations | T-002 | **Opus 5** |
| **I** — autenticação | T-004 | **Opus 5** |
| **A** — API e persistência | T-108, T-302, T-402 | **Sonnet 5** |
| **U** — telas | T-005, T-109, T-111…T-115, T-204…T-208, T-303…T-306 | **Sonnet 5** |
| **I** — bootstrap, infra, PWA, cron | T-001, T-116, T-403, T-406 | **Sonnet 5** |
| Revisão de entrega de tarefa **P** ou **D** | T-002, T-003, T-101…T-104, T-107, T-110, T-117, T-119…T-121, T-201…T-203, T-206 | **Sonnet 5** desde 2026-09-10, por decisão do humano (agente distinto do que implementou) |
| Revisão do **T-301** (planejador de renda passiva) | T-301 | **Opus 5** — exceção recomendada: é a tarefa onde erro de fórmula distorce decisão de 20 anos, e o revisor precisa ser pelo menos tão forte quanto quem implementou |
| Revisão de entrega **A**, **U**, **I** | demais | **Sonnet 5** |

Regras que acompanham a atribuição:

1. **Revisor nunca é o implementador.** Em tarefa P e D, a revisão roda como agente separado, com o contrato e o aceite em mão, sem ver o raciocínio do implementador.
2. **Fórmula financeira não é delegada a modelo rápido**, nem "só para adiantar". T-301 em particular é Opus 5 e tem gate humano.
3. Tarefa **U** que carrega regra de cálculo na tela está mal fatiada: o cálculo pertence a `/lib/finance`. Reclassifique para P em vez de subir o modelo.
4. Se uma tarefa Sonnet 5 for reprovada duas vezes na validação (§7), promova para Opus 5 e registre no STATUS.

## 10. Estado do projeto

O orquestrador mantém `docs/STATUS.md` com uma linha por tarefa: `ID · estado (todo | doing | review | done | blocked) · agente · data · nota`. É o único arquivo de docs que ele escreve livremente, e a primeira coisa que lê ao retomar uma sessão.
