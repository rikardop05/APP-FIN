# APPFIN — Controle e Planejamento Financeiro Familiar

**Versão da spec:** 1.1 · **Data:** 2026-09-09 · **Status:** aprovada para construção (Fase 1)

> Este arquivo responde **o que** o app faz e **por quê**. Ele não é o input direto dos agentes que escrevem código.
>
> | Arquivo | Papel | Quem lê |
> |---|---|---|
> | [`ORCHESTRATION.md`](./ORCHESTRATION.md) | como delegar, paralelismo, gates, defaults | orquestrador |
> | [`BUILD-PLAN.md`](./BUILD-PLAN.md) | tarefas com dependências, posse de arquivo e aceite | orquestrador |
> | [`CONVENTIONS.md`](./CONVENTIONS.md) | regras invioláveis de código | **todo** agente |
> | [`CONTRACTS.md`](./CONTRACTS.md) | assinaturas do motor puro | agente da tarefa |
> | [`DATA-MODEL.md`](./DATA-MODEL.md) | schema canônico | agente da tarefa |
> | [`IMPORT-SOURCES.md`](./IMPORT-SOURCES.md) | formato de entrada por banco e escada de fallback | agente de importação |
> | `STATUS.md` | estado de cada tarefa | orquestrador |

---

## 1. Visão geral

Aplicação web privada, usada por **duas pessoas** (Ricardo e esposa), para:

1. **Controlar** o que já aconteceu: faturas de cartão, despesas fixas, receitas da família.
2. **Projetar** o que vai acontecer: parcelas futuras, despesas recorrentes, saldo dos próximos meses.
3. **Planejar** o longo prazo: quanto investir por mês para atingir uma meta de renda passiva, em cenários conservador / médio / otimista.
4. **Visualizar**: um dashboard que responde em 10 segundos "como estamos este mês e para onde estamos indo".

### Princípios de produto

| # | Princípio | Consequência prática |
|---|-----------|----------------------|
| P1 | **Atrito zero mata o app** | Importar uma fatura tem que levar < 2 min. Nada que exija digitar 80 linhas. |
| P2 | **Projeção > histórico** | O valor está em saber o comprometimento dos próximos 12 meses, não em relatórios do passado. |
| P3 | **Dados nossos, casa nossa** | Sem credenciais bancárias no app. Sem terceiros lendo extrato. |
| P4 | **Duas pessoas, um caixa** | Tudo é compartilhado por padrão; atribuição por pessoa é um atributo, não uma separação. |
| P5 | **Números explícitos** | Toda projeção mostra as premissas usadas e permite editá-las. Nenhuma "mágica" fechada. |

---

## 2. Decisões travadas

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Plataforma | **Web responsivo + PWA** (instalável no celular) | Um só código para celular e desktop; ambos acessam de qualquer aparelho. |
| Entrada de dados (v1) | **PDF (com senha quando cifrado) > texto colado** + lançamento manual | Dois caminhos, um só funil de confirmação. Nenhum banco fica sem forma de entrada, sem custo e sem credencial bancária no app. |
| **CSV, XLS/XLSX e OFX** | **adiados para a Fase 4** (T-105, T-118, T-106) | CSV e XLSX por decisão do humano (compartilham a maquinaria de mapeamento de coluna, que sai inteira da v1). **OFX porque nenhum dos três bancos oferece**, verificado em 2026-09-09. |
| Bancos em uso | Nubank, Santander, Mercado Pago (cartão e conta) | Define a ordem dos parsers. Formato de cada um em [`IMPORT-SOURCES.md`](./IMPORT-SOURCES.md). |
| Perfil de manutenção | Stack única TypeScript, um repositório, um banco | Poucas peças móveis; máxima densidade de exemplos para geração assistida por IA. |
| Moeda / locale | BRL, pt-BR, fuso America/Sao_Paulo | Uso doméstico brasileiro. |
| Multiusuário | 1 "household" com 2 membros | Não é SaaS. Sem faturamento, sem onboarding público. |

### 2.1 Stack recomendada

```
Frontend + Backend : Next.js 15 (App Router) + TypeScript  — um projeto só
UI                 : Tailwind CSS + shadcn/ui
Gráficos           : Recharts
Banco              : PostgreSQL (Neon ou Supabase — free tier serve)
ORM                : Drizzle ORM (migrations versionadas em SQL legível)
Auth               : Auth.js (magic link por e-mail) — 2 contas, allowlist fixa
Validação          : Zod (um schema por fronteira: form, API, import)
Parse de arquivos  : pdfjs-dist (PDF, camada de texto) + parser de texto próprio
                     biblioteca OFX, PapaParse (CSV) e exceljs (XLSX) ficam para a Fase 4
Datas              : date-fns + date-fns-tz
Testes             : Vitest (regras de cálculo e parsers — obrigatório aqui)
Deploy             : Vercel (app) + Neon/Supabase (banco), ambos free tier
```

**Por que essa e não outra:** um único idioma (TypeScript) do banco à tela, um único deploy, tipos compartilhados entre servidor e cliente. É a combinação com mais exemplos públicos, portanto a que a IA escreve com menos erro. Alternativa descartada: Python/FastAPI + React separados (duas linguagens, dois deploys, dois conjuntos de tipos — atrito desnecessário para 2 usuários).

**Custo esperado:** R$ 0/mês nos free tiers. Domínio próprio opcional (~R$ 40/ano).

---

## 3. Arquitetura

```
┌────────────────────────────────────────────────────────┐
│  Navegador (PWA)                                       │
│  Dashboard · Lançamentos · Faturas · Planejador        │
└───────────────────────────┬────────────────────────────┘
                            │  HTTPS
┌───────────────────────────▼────────────────────────────┐
│  Next.js (Vercel)                                      │
│                                                        │
│  /app          → telas (Server Components)             │
│  /app/api      → rotas de import e mutações            │
│  /lib/import   → parsers por banco (funções puras)     │
│  /lib/finance  → motor de cálculo (funções puras)      │
│  /lib/db       → schema Drizzle + queries              │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│  PostgreSQL                                            │
└────────────────────────────────────────────────────────┘
```

**Regra arquitetural única e não negociável:** `/lib/finance` e `/lib/import` são **funções puras** — recebem dados, devolvem dados, não tocam banco nem rede. Todo cálculo financeiro e todo parser vive ali, com teste unitário. É o que permite confiar nos números e refatorar a UI sem medo.

---

## 4. Modelo de dados

**O schema canônico vive em [`DATA-MODEL.md`](./DATA-MODEL.md)** — tabelas, colunas, tipos, enums, constraints, índices e seed obrigatório. Divergência entre aquele arquivo e o código é bug do código.

Resumo das 18 entidades: `households` · `members` · `accounts` · `credit_cards` · `statements` · `categories` · `transactions` · `installment_plans` · `categorization_rules` · `import_mappings` · `import_batches` · `recurring_expenses` · `incomes` · `budgets` · `goals` · `investment_plans` · `investment_scenarios` · `household_settings`.

> **Nomenclatura (v1.1):** schema e código em **inglês**, textos de UI em **pt-BR**. Ver [`CONVENTIONS.md`](./CONVENTIONS.md) §1. A v1.0 desta spec misturava os dois; a mistura fazia cada agente adivinhar o nome de coluna, e agentes em paralelo adivinhavam diferente.

---

## 5. Módulos funcionais

### 5.1 Importação de faturas e extratos

**Dois caminhos na v1, uma só tela de confirmação:** **PDF com camada de texto** e **texto colado** como fallback universal. Nenhum dos três bancos da família oferece OFX; CSV, XLS/XLSX e OFX são plano futuro (Fase 4). Racional em [`IMPORT-SOURCES.md`](./IMPORT-SOURCES.md) §3.

**Fluxo:** entrada (arquivo ou cola) → detecção de formato/banco → parse → auto-categorização → **tela de confirmação editável** → gravar.

Requisitos:

- **RF-IMP-01** Aceitar upload de **PDF**, detectando a origem por assinatura do conteúdo. Arquivos `.ofx`, `.csv`, `.xls` e `.xlsx` são reconhecidos e **recusados com orientação** ("abra o arquivo e cole o conteúdo no card de texto"), até T-106, T-105 e T-118 entrarem na Fase 4, junto com o mapeamento de coluna por banco e o mapeador manual (T-401).
- **RF-IMP-02** **Confirmação obrigatória antes de gravar.** Nenhum lançamento é persistido no parse: a tela mostra todas as linhas e o usuário confirma. Na tela, são **editáveis linha a linha**:
  - **data** — recalcula a competência da fatura na hora;
  - **valor** — com sinal, recalcula o total do lote;
  - **descrição** — sem nunca sobrescrever `raw_description`;
  - **parcelamento** — marcar/desmarcar como parcelada e ajustar parcela atual e total (ex: corrigir 3/10 para 4/10);
  - **categoria** e **responsável**;
  - **incluir ou excluir a linha** do lote.

  A tela exibe, por linha, o estado (nova | duplicada | parcelada) e, nas entradas de baixa confiança (PDF e texto colado), o **nível de confiança** do parse. Rodapé com total do lote vs total informado na fatura.
- **RF-IMP-03** Detectar compras parceladas pela descrição (padrões `PARC 03/10`, `03/10`, `PARCELA 3 DE 10`, `(3 de 10)`) e oferecer criação de `installment_plan` com projeção das parcelas restantes — sempre revisável na confirmação.
- **RF-IMP-04** Vincular a importação a um `statement` (cartão + mês de referência) e comparar total do arquivo vs soma das linhas; alertar divergência sem bloquear.
- **RF-IMP-05** Desfazer importação inteira em um clique.
- **RF-IMP-06** Auditoria: nunca sobrescrever `raw_description`.
- **RF-IMP-07** **Entrada por texto colado**, em card dedicado na tela de importação: uma área de texto onde o usuário cola linhas de fatura ou extrato de qualquer origem. O parser heurístico identifica data, descrição e valor por linha, atribui **confiança** (alta | média | baixa) e envia tudo para a mesma tela de confirmação. Linha que ele não conseguir interpretar aparece na tela **em branco e editável**, com o texto original ao lado — nunca é descartada em silêncio.
- **RF-IMP-08** **PDF é o caminho principal da v1**, para os três bancos da família (Nubank, Santander, Mercado Pago), com camada de texto confirmada por sonda em [`IMPORT-SOURCES.md`](./IMPORT-SOURCES.md) §2. Extração via `pdfjs-dist`, que trata decifragem, fontes CID e `ToUnicode` CMap. Decodificação **sempre** pelo `ToUnicode` do próprio arquivo, nunca por offset chumbado. PDF sem camada de texto cai no texto colado (RF-IMP-07). OCR segue fora de escopo.
- **RF-IMP-11** **PDF protegido por senha.** As faturas de Santander (RC4) e Mercado Pago (AES-256) são cifradas. O card de upload traz um **campo de senha opcional**, exibido quando o arquivo é detectado como cifrado. Regras:
  - a senha é usada **em memória**, apenas para abrir o arquivo naquela importação;
  - **nunca é persistida** em banco, cookie, `localStorage` ou log, e nunca aparece em mensagem de erro;
  - senha errada devolve erro claro ("não foi possível abrir o PDF: senha incorreta"), sem tentativa de força bruta;
  - PDF cifrado sem senha informada não é tratado como "sem camada de texto": a mensagem pede a senha;
  - uma cópia salva sem senha também é aceita, mas o app **não exige** esse passo do usuário.
- **RF-IMP-12** **Remontagem de linha por coordenada.** Os PDFs emitem cada célula como um run de texto posicionado — na fatura do Santander, 884 runs renderam apenas 1 linha com data e valor juntos. O extrator agrupa runs por coordenada `y` (com tolerância) e ordena por `x` antes de qualquer heurística. É infraestrutura **comum aos três bancos**, não código por banco.
- **RF-IMP-09** **Recomputação após edição:** competência e `dedupe_hash` são calculados sobre os **valores confirmados**, não sobre os valores lidos. Consequência registrada: corrigir data ou valor de uma linha muda o hash, e reimportar o mesmo arquivo poderia reintroduzi-la — mitigado por RF-IMP-10.
- **RF-IMP-10** **Arquivo já importado:** `import_batches.file_hash` é verificado na entrada; se o arquivo já foi importado, avisar com a data do lote anterior e exigir confirmação explícita para seguir.

### 5.2 Categorização

- **RF-CAT-01** Árvore de categorias com 2 níveis, pré-populada com um padrão brasileiro editável (Moradia, Alimentação, Transporte, Saúde, Educação, Lazer, Assinaturas, Vestuário, Impostos, Investimentos, Renda).
- **RF-CAT-02** Cada categoria tem `nature` (`essential` / `non_essential` / `investment` / `income`).
- **RF-CAT-03** Auto-categorização por regras, aplicadas por ordem de prioridade. Regra criada a partir de uma correção manual, com um clique.
- **RF-CAT-04** Fila de "não categorizados" visível no dashboard — é o único trabalho manual recorrente do sistema e precisa ser pequeno e óbvio.

### 5.3 Cartões de crédito e parcelas futuras

- **RF-CC-01** Cadastro de cartão com dia de fechamento e vencimento.
- **RF-CC-02** Dado a data da compra, calcular a competência da fatura: se o dia da compra > `closing_day`, cai na fatura do mês seguinte.
- **RF-CC-03** Visão **"Comprometimento futuro"**: tabela dos próximos 24 meses com o total já contratado por cartão (soma das parcelas futuras), gráfico de barras decrescente e o mês em que o comprometimento zera.
- **RF-CC-04** Registrar pagamento de fatura como `transaction` de `kind = 'credit_card_payment'` na conta bancária — sem contar duas vezes na despesa (o gasto já foi contado nos itens da fatura).
- **RF-CC-05** Alerta de limite: % do limite comprometido por cartão.

### 5.4 Despesas fixas, receitas e orçamento

- **RF-ORC-01** Cadastro de despesas recorrentes e receitas com periodicidade e vigência.
- **RF-ORC-02** Geração automática das ocorrências previstas nos próximos 12 meses (marcadas como *previsto*, não *realizado*).
- **RF-ORC-03** Conciliação previsto vs realizado: ao importar, casar lançamento realizado com a despesa recorrente prevista (por categoria + faixa de valor + janela de data).
- **RF-ORC-04** Orçamento mensal por categoria, com opção "repetir do mês anterior" e "usar média dos últimos 3 meses".
- **RF-ORC-05** Acompanhamento do orçamento: gasto / planejado / restante, com semáforo (verde < 80%, amarelo 80–100%, vermelho > 100%).

### 5.5 Fluxo de caixa projetado

- **RF-FLX-01** Projeção mês a mês para 12 meses:
  `saldo_projetado(m) = saldo_inicial(m) + receitas_previstas(m) − despesas_recorrentes(m) − parcelas_futuras(m) − faturas_a_vencer(m) − aportes_planejados(m)`
- **RF-FLX-02** Gráfico de linha do saldo projetado, com destaque em vermelho nos meses de saldo negativo.
- **RF-FLX-03** Modo "e se": alterar uma premissa (ex: cortar R$ 500 de lazer, receber um 13º) e ver o impacto na curva, sem salvar.

### 5.6 Planejador de renda passiva — o módulo diferencial

O usuário informa: **renda passiva mensal desejada** (em poder de compra de hoje), **patrimônio atual**, **aporte mensal que consegue fazer hoje** e, opcionalmente, **prazo desejado**. O app devolve, para cada um dos três cenários:

- patrimônio-alvo necessário;
- tempo até a meta com o aporte atual;
- aporte necessário para atingir a meta em 5, 10, 15, 20 anos;
- curva de acumulação;
- renda passiva projetada ano a ano.

#### Fórmulas (todas em termos **reais**, ou seja, já descontada a inflação)

Notação: `R` = renda passiva mensal desejada · `P0` = patrimônio atual · `A` = aporte mensal · `r` = taxa real anual de retorno na acumulação · `w` = taxa real anual de retirada perpétua · `n` = meses.

**1. Patrimônio-alvo (renda perpétua, sem consumir o principal em termos reais):**
```
patrimonio_alvo = (R * 12) / w
```

**2. Taxa mensal equivalente (capitalização composta, nunca dividir por 12):**
```
i = (1 + r) ^ (1/12) - 1
```

**3. Valor futuro após n meses:**
```
FV(n) = P0 * (1 + i)^n + A * ((1 + i)^n - 1) / i
```

**4. Tempo até a meta (meses), dado o aporte:**
```
n = ln( (patrimonio_alvo * i + A) / (P0 * i + A) ) / ln(1 + i)
```
Se `A + P0 * i <= 0` → meta inalcançável; exibir mensagem, não NaN.

**5. Aporte necessário, dado o prazo:**
```
A = (patrimonio_alvo - P0 * (1 + i)^n) * i / ((1 + i)^n - 1)
```
Se resultado ≤ 0 → o patrimônio atual já atinge a meta no prazo; exibir isso.

**6. Renda passiva projetada em qualquer momento:**
```
renda_mensal(n) = FV(n) * w / 12
```

#### Cenários padrão (editáveis, nunca hard-coded na UI)

| Cenário | Retorno real a.a. (`r`) | Retirada real a.a. (`w`) | Referência mental |
|---------|------------------------|--------------------------|-------------------|
| Conservador | 3,0 % | 3,0 % | Tesouro IPCA+ ~3 %, líquido de IR |
| Médio | 5,0 % | 4,0 % | Carteira mista renda fixa + FIIs |
| Otimista | 7,0 % | 5,0 % | Peso maior em bolsa/FIIs, mais volatilidade |

Premissas globais editáveis: inflação (default IPCA 4,5 % a.a.), alíquota de IR sobre rendimentos (default 15 %).

**Regras de honestidade numérica (obrigatórias na UI):**

- **RF-INV-01** Todo valor exibido é **real** (poder de compra de hoje). Mostrar rótulo "valores em R$ de hoje" em toda tela do módulo.
- **RF-INV-02** Exibir as premissas de cada cenário ao lado do resultado, sempre editáveis.
- **RF-INV-03** Retorno passado não é garantia — aviso curto e permanente no módulo.
- **RF-INV-04** Toda fórmula do módulo tem teste unitário com valores conferidos à mão.
- **RF-INV-05** Comparar o aporte necessário com a **sobra de caixa real** do orçamento (5.4) e sinalizar quando a meta exige mais do que a família tem sobrando hoje. É a ligação entre o controle e o planejamento — a razão de os dois módulos morarem no mesmo app.

### 5.7 Metas e reserva de emergência

- **RF-MET-01** Metas com valor-alvo, data-alvo e aporte mensal necessário calculado.
- **RF-MET-02** Reserva de emergência com alvo sugerido = `N × despesa_essencial_mensal_media` (N configurável, default 6).
- **RF-MET-03** Barra de progresso por meta e ordenação por prioridade.

### 5.8 Dashboard

**Linha 1 — KPIs do mês corrente**

| KPI | Cálculo |
|-----|---------|
| Receita do mês | soma das receitas realizadas + previstas restantes |
| Despesa do mês | soma das despesas realizadas + previstas restantes |
| Sobra / déficit | receita − despesa |
| Taxa de poupança | (receita − despesa) / receita |
| Comprometimento com essenciais | despesas de `nature = 'essential'` / receita |
| Parcelas a vencer (12 m) | soma das parcelas futuras |

**Linha 2 — gráficos**

1. **Receita vs despesa** — barras agrupadas, últimos 12 meses.
2. **Gastos por categoria** — barras horizontais ordenadas do mês corrente, com variação vs média de 3 meses.
3. **Saldo projetado** — linha, próximos 12 meses (5.5).
4. **Comprometimento futuro em parcelas** — barras, próximos 24 meses (5.3).
5. **Progresso da renda passiva** — patrimônio atual vs alvo, com as 3 curvas de cenário.

**Linha 3 — ações pendentes**

- lançamentos não categorizados (com contador);
- faturas com divergência de conciliação;
- orçamentos estourados no mês;
- despesas recorrentes previstas e não realizadas.

Requisitos transversais de visualização:
- **RF-DASH-01** Todo gráfico legível em tela de 390 px de largura (celular).
- **RF-DASH-02** Seletor global de período (mês, trimestre, ano, 12 meses móveis).
- **RF-DASH-03** Todo valor monetário formatado pt-BR (`R$ 1.234,56`).

---

## 6. Regras de cálculo transversais

- **RC-01** Valores monetários armazenados como **inteiro em centavos** (`bigint`, sufixo `_cents`). Nunca `float`. Formatação apenas na borda de exibição.
- **RC-02** Sinal: despesa negativa, receita positiva. Uma única convenção em todo o sistema.
- **RC-03** Transferências entre contas próprias e `credit_card_payment` **não** entram em "despesa do mês" (evita contagem dupla).
- **RC-04** Aportes em investimento contam como saída de caixa, mas aparecem separados de "despesa" nos KPIs — é poupança, não consumo.
- **RC-05** Competência ≠ caixa: a fatura tem mês de competência (quando os gastos ocorreram) e mês de pagamento. Relatórios de gasto usam competência; fluxo de caixa usa pagamento.
- **RC-06** Datas em `date` (sem hora) para lançamentos; timestamps em UTC com conversão para America/Sao_Paulo na exibição.

---

## 7. Telas

| Tela | Conteúdo |
|------|----------|
| `/` Dashboard | Seção 5.8 |
| `/lancamentos` | Tabela filtrável (período, categoria, cartão/conta, membro, texto), edição inline, ação em lote de categorizar |
| `/importar` | Upload, preview, conciliação, histórico de importações com desfazer |
| `/cartoes` | Cartões, faturas por mês, comprometimento futuro, parcelas em andamento |
| `/orcamento` | Despesas fixas, receitas, orçamento por categoria, previsto vs realizado |
| `/fluxo` | Projeção de 12 meses e simulador "e se" |
| `/investimentos` | Planejador de renda passiva, cenários, curvas, aporte necessário |
| `/metas` | Metas e reserva de emergência |
| `/config` | Categorias, regras, contas, membros, premissas globais |

---

## 8. Requisitos não funcionais

- **RNF-01 Privacidade:** acesso restrito a 2 e-mails em allowlist. Sem cadastro público. Sem analytics de terceiros.
- **RNF-02 Backup:** exportação completa (JSON + CSV) sob demanda; backup automático do Postgres pelo provedor. Importação de backup para restaurar.
- **RNF-03 Desempenho:** dashboard carrega em < 1,5 s com 10 anos de dados (~50 mil lançamentos). Índices em `(household_id, data)`, `dedupe_hash` único, `statement_id`.
- **RNF-04 Mobile:** PWA instalável, funcional em 390 px, offline apenas para leitura do último estado carregado.
- **RNF-05 Testes:** cobertura obrigatória em `/lib/finance` e `/lib/import`. UI sem exigência de cobertura.
- **RNF-06 Custo:** ≤ R$ 0/mês em infraestrutura.
- **RNF-07 Acessibilidade básica:** contraste AA, navegação por teclado nas tabelas, gráficos com tabela de dados alternativa.

---

## 9. Roadmap por fases

Cada fase é **utilizável de ponta a ponta** — nada de "fase de backend". A decomposição em tarefas delegáveis está em [`BUILD-PLAN.md`](./BUILD-PLAN.md).

**Fase 1 — Fundação e cartões** *(o app já vale a pena aqui)*
Auth com 2 contas · modelo de dados · categorias e regras · importação (PDF + texto colado) · tela de confirmação editável · detecção de parcelas · tela de lançamentos · visão de comprometimento futuro · dashboard mínimo (3 KPIs + gastos por categoria).

**Fase 2 — Orçamento e fluxo de caixa**
Despesas recorrentes · receitas da família · orçamento por categoria com semáforo · conciliação previsto vs realizado · projeção de 12 meses · dashboard completo.

**Fase 3 — Planejamento de renda passiva**
`investment_plan` e cenários · todas as fórmulas da 5.6 com testes · curvas de acumulação · aporte necessário por prazo · cruzamento com a sobra real do orçamento · metas e reserva de emergência.

**Fase 4 — Refinos**
**Parser de OFX (T-106), de CSV (T-105), de XLS/XLSX (T-118) e mapeamentos por banco (T-105a/b/c)** · mais bancos e mapeamento manual salvo · simulador "e se" · exportação/backup · registro de posição real de investimentos (aportes efetivos vs planejados).

---

## 10. Fora de escopo (v1)

Multi-moeda · Open Finance/agregador bancário · integração com corretora · imposto de renda e cálculo de DARF · controle de dívidas com juros compostos e renegociação · divisão de despesas com rateio entre cônjuges (os dois veem um caixa único) · app nativo · multiusuário além dos 2 membros · IA de recomendação de investimento.

---

## 11. Riscos e questões abertas

As questões abertas têm **default aplicado** — nenhum agente trava esperando resposta. A tabela completa de defaults está em [`ORCHESTRATION.md`](./ORCHESTRATION.md) §5.

| # | Ponto | Encaminhamento |
|---|-------|----------------|
| R1 | ~~Quais bancos vocês usam?~~ **Respondido:** Nubank, Santander, Mercado Pago. ~~Algum oferece OFX?~~ **Respondido: nenhum.** | Resolvido. Resta confirmar CSV/XLSX (T-100), que é insumo da Fase 4. |
| R6 | **Toda a entrada da v1 vem de PDF ou de colagem** — nenhum banco oferece OFX, e CSV/XLSX estão adiados | PDF do Nubank tem parser próprio (T-117); o **texto colado** (T-119) cobre o resto. Detalhe em [`IMPORT-SOURCES.md`](./IMPORT-SOURCES.md) §2–3. |
| R8 | ~~Atrito mensal: Santander e Mercado Pago exigiriam conversão manual todo mês~~ | **Resolvido.** A sonda (2026-09-10) confirmou camada de texto nos três: o Santander falhava por cifragem RC4 e layout em colunas, o Mercado Pago por cifragem AES-256 e fonte CID em hexadecimal — nenhum por falta de texto. Rotina mensal: subir três PDFs. |
| R9 | **Senha de PDF é dado sensível** | RF-IMP-11: senha só em memória, nunca persistida, nunca logada, nunca em mensagem de erro. Nenhum agente pode "guardar para facilitar" — está nos defaults do orquestrador. |
| R7 | Parser heurístico de texto pode interpretar linha errado | A tela de confirmação editável (RF-IMP-02) é a rede de proteção, mais o nível de confiança por linha e a conferência do total do lote contra o total da fatura. |
| R10 | **Layout de PDF muda a cada redesign do banco** | Três defesas: total da fatura conferido contra a soma das linhas (RF-IMP-04), tela de confirmação editável (RF-IMP-02) e texto colado como rede de segurança (RF-IMP-07). Fixtures de meses diferentes no teste de cada parser. |
| R2 | Formatos de export mudam sem aviso | Na v1, o **texto colado** (RF-IMP-07) mais a confirmação editável absorvem qualquer mudança sem alterar código. O mapeador manual salvo por banco entra na Fase 4 (T-401) e reduz o trabalho manual. |
| R3 | Abandono por atrito | Meta: importar fatura em < 2 min. Se a fila de "não categorizados" passar de ~10 itens/mês, as regras estão fracas. |
| R4 | Falsa precisão no planejador | Cenários explícitos e editáveis + aviso permanente (RF-INV-01 a 03). |
| R5 | Free tier de banco hiberna / limita | Aceitável para 2 usuários. Backup periódico (RNF-02) protege contra perda. |
| Q1 | Vocês já têm investimentos hoje e querem lançar a posição real? | **Default aplicado:** Fase 3 apenas planeja; posição real é T-404 (Fase 4). Um "sim" antecipa T-404. |
| Q2 | Querem destacar "quem gastou o quê"? | **Default aplicado:** caixa consolidado; `member_id` existe e é opcional, sem destaque na UI. |
| Q3 | Renda variável (13º, PLR, bônus) entra na projeção? | **Default aplicado:** sim, via `incomes.frequency = 'one_off'` + `one_off_competence`. Já contemplado no schema. |

---

## 12. Critérios de aceite da Fase 1

1. Os dois membros logam com magic link; ninguém mais entra.
2. Importar o arquivo de um cartão real cria os lançamentos corretos, sem duplicar quando o mesmo arquivo é subido duas vezes.
2b. Colar o texto de uma fatura produz o mesmo resultado, com as linhas mal interpretadas editáveis antes de gravar.
2c. Editar data, valor, descrição e parcelamento na tela de confirmação grava exatamente o que foi confirmado.
3. Uma compra em 10x importada gera 10 parcelas e o comprometimento futuro reflete isso nos 10 meses seguintes.
4. ≥ 80 % dos lançamentos de uma fatura típica chegam auto-categorizados após duas importações (as regras aprenderam).
5. Total calculado da fatura = total informado no arquivo, ou o app avisa.
6. Desfazer uma importação remove exatamente os lançamentos dela.
7. Dashboard legível e utilizável no celular.
8. `/lib/finance` e `/lib/import` com testes verdes.
