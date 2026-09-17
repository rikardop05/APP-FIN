# DATA-MODEL — schema canônico

> Fonte única de verdade do banco. Divergência entre este arquivo e o código é bug do código.
> Identificadores em inglês (CONVENTIONS §1). Dinheiro em `bigint` de centavos (§2). Percentual em basis points (§3).

Todas as tabelas: `id uuid primary key default gen_random_uuid()`.
Todas, exceto as filhas de `households`, têm `household_id uuid not null references households(id) on delete cascade`.
Exceção única a essas duas regras: `verification_token`, infraestrutura do Auth.js — sem `id` e sem `household_id` (ver §2).

---

## 1. Enums

```
account_kind      : checking | savings | cash | brokerage
card_brand        : visa | mastercard | elo | amex | other
statement_status  : open | closed | paid
record_source     : import | manual | generated
transaction_kind  : expense | income | transfer | credit_card_payment | investment_contribution
transaction_status: posted | planned
category_nature   : essential | non_essential | investment | income
match_type        : contains | regex | exact
frequency         : monthly | bimonthly | quarterly | semiannual | annual | one_off
income_kind       : salary | pro_labore | variable | rent | other
goal_status       : active | achieved | paused | cancelled
scenario_label    : conservative | moderate | optimistic
import_status     : pending | committed | reverted | failed
import_format     : ofx | csv | xlsx | pdf | text
```

## 2. Tabelas

### households
| coluna | tipo | notas |
|---|---|---|
| name | text not null | |
| created_at | timestamptz not null default now() | |

### members
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| name | text not null | |
| email | text not null unique | usado na allowlist de login |
| color | text not null | hex, usado em gráficos |

### accounts
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| name | text not null | |
| bank | text | |
| kind | account_kind not null | |
| opening_balance_cents | bigint not null default 0 | saldo no dia `opening_date` |
| opening_date | date not null | marco zero do saldo desta conta |
| active | boolean not null default true | |

### credit_cards
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| name | text not null | |
| bank | text | |
| brand | card_brand not null default 'other' | |
| holder_member_id | uuid references members(id) | |
| payment_account_id | uuid references accounts(id) | conta de onde sai o pagamento |
| credit_limit_cents | bigint | |
| closing_day | smallint not null | 1–31, dia de fechamento |
| due_day | smallint not null | 1–31, dia de vencimento |
| active | boolean not null default true | |

> `closing_day`/`due_day` > último dia do mês são ajustados para o último dia (regra em `/lib/finance/billing`).

### statements
| coluna | tipo | notas |
|---|---|---|
| credit_card_id | uuid not null | |
| period | text not null | competência `YYYY-MM` |
| closing_date | date not null | |
| due_date | date not null | |
| reported_total_cents | bigint | total informado no arquivo; null se manual |
| status | statement_status not null default 'open' | |
| source | record_source not null | |
| paid_transaction_id | uuid references transactions(id) | lançamento do pagamento |

`unique (credit_card_id, period)`
> `computed_total_cents` **não é coluna** — é sempre a soma das transações com este `statement_id`. Divergência com `reported_total_cents` gera alerta de conciliação.

### categories
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| name | text not null | |
| parent_id | uuid references categories(id) | **máximo 1 nível**: se `parent_id` não é null, `parent_id` daquele registro tem de ser null |
| nature | category_nature not null | |
| icon | text | |
| color | text | |
| sort_order | integer not null default 0 | |

Constraints e índices:
- `unique (household_id, parent_id, name)` — impede filhas homônimas sob a mesma raiz.
- `unique index (household_id, name) where parent_id is null` — **impede raiz homônima.** Necessário porque `NULL` não colide com `NULL` em Postgres, então o unique acima **não** cobre raízes. Índice parcial em vez de `NULLS NOT DISTINCT` para não depender de versão do servidor.
- profundidade de 1 nível: **não** é CHECK (exigiria subconsulta). Vale na borda — Zod na rota e validação na UI recusam `parent_id` que aponte para categoria que já tem `parent_id`.

**Regra de `nature`, resolvida em 2026-09-10:** `nature` pertence à **categoria onde o lançamento cai**, e a raiz é agrupamento. Uma raiz pode ter filhas de naturezas diferentes — "Alimentação" tem "Mercado" (`essential`) e "Restaurantes" (`non_essential`) sob a mesma raiz. Relatórios e KPIs somam pela `nature` da categoria do próprio lançamento, nunca pela da raiz. A raiz carrega uma `nature` apenas para o caso de lançamento anexado direto nela.

Consequência prática: **não existem duas raízes com o mesmo nome.** Duas "Alimentação" no seletor seria pior para quem usa, e quebraria a busca por nome.


### transactions
O registro central.

| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| occurred_on | date not null | data do fato (compra, recebimento) |
| competence | text not null | `YYYY-MM`; em cartão = competência da fatura, não o mês da compra |
| cash_date | date | data prevista/efetiva de saída do caixa; em item de fatura = `due_date` da fatura |
| description | text not null | editável pelo usuário |
| raw_description | text not null | como veio do arquivo ou da linha colada; **nunca sobrescrever**. String vazia só em lançamento manual |
| amount_cents | bigint not null | negativo = saída |
| kind | transaction_kind not null | |
| status | transaction_status not null default 'posted' | `planned` = previsto (parcela futura, recorrência) |
| category_id | uuid references categories(id) on delete restrict | null = não categorizado |
| account_id | uuid references accounts(id) | |
| credit_card_id | uuid references credit_cards(id) on delete restrict | |
| statement_id | uuid references statements(id) | |
| member_id | uuid references members(id) | quem gastou |
| installment_plan_id | uuid references installment_plans(id) on delete cascade | |
| installment_number | smallint | 1-based |
| recurring_expense_id | uuid references recurring_expenses(id) | origem, quando gerado |
| income_id | uuid references incomes(id) | origem, quando gerado |
| import_batch_id | uuid references import_batches(id) | |
| dedupe_hash | text | null para lançamento manual |
| note | text | |
| created_at / updated_at | timestamptz not null default now() | |

Constraints:
- `check`: exatamente um de `account_id` / `credit_card_id` é não-nulo.
- `check`: `installment_number` não-nulo se e somente se `installment_plan_id` não-nulo.
- `unique index (household_id, dedupe_hash) where dedupe_hash is not null`.

Índices: `(household_id, occurred_on desc)`, `(household_id, competence)`, `(statement_id)`, `(household_id, category_id)`, `(import_batch_id)`, `(household_id, status, cash_date)`.

### installment_plans
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| credit_card_id | uuid not null | |
| description | text not null | |
| total_cents | bigint not null | negativo (é despesa) |
| installments_count | smallint not null | |
| first_competence | text not null | `YYYY-MM` |
| category_id | uuid references categories(id) | |
| source | record_source not null | `import` = detectado na fatura |
| created_at | timestamptz not null default now() | |

> `installment_cents` **não é coluna**: as parcelas são as transações filhas, geradas por `allocate()` para somar exatamente `total_cents`.

### categorization_rules
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| pattern | text not null | |
| match_type | match_type not null default 'contains' | |
| category_id | uuid not null references categories(id) | |
| member_id | uuid references members(id) | sugestão de responsável |
| priority | integer not null default 100 | menor = avaliado primeiro |
| hits | integer not null default 0 | |
| active | boolean not null default true | |

### import_mappings
Mapeamento de colunas salvo por banco (RF-IMP-01).

| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| bank_key | text not null | slug: `nubank_card`, `itau_checking` |
| format | import_format not null | apenas `csv` ou `xlsx`; `ofx`, `pdf` e `text` não usam mapeamento de coluna |

`check`: `format in ('csv', 'xlsx')` — mapeamento de coluna só faz sentido para formato tabular.
| column_map | jsonb not null | `{date, description, amount}` ou `{date, description, debit, credit}` |
| date_format | text not null | ex: `dd/MM/yyyy` |
| decimal_separator | text not null default ',' | |
| amount_sign_inverted | boolean not null default false | |
| header_signature | text | hash do cabeçalho, usado na detecção |

`unique (household_id, bank_key)`

### import_batches
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| file_name | text not null | |
| file_hash | text not null | sha256 do conteúdo (ou do texto colado). Verificado na entrada para avisar "arquivo já importado" — RF-IMP-10 |
| bank_key | text | |
| format | import_format not null | `text` = colagem; nesse caso `file_name` recebe um rótulo dado pelo usuário e `file_hash` é o sha256 do texto colado |
| credit_card_id / account_id | uuid | destino do lote |
| statement_id | uuid references statements(id) | |
| rows_read / rows_imported / rows_duplicated | integer not null default 0 | |
| status | import_status not null default 'pending' | |
| error | text | |
| created_at | timestamptz not null default now() | |

### recurring_expenses
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| description | text not null | |
| expected_cents | bigint not null | negativo |
| category_id | uuid not null | |
| due_day | smallint not null | |
| frequency | frequency not null default 'monthly' | |
| account_id / credit_card_id | uuid | onde debita |
| starts_on | date not null | |
| ends_on | date | null = sem fim |
| annual_adjustment_bp | integer | reajuste anual, aplicado no aniversário de `starts_on` |
| active | boolean not null default true | |

### incomes
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| member_id | uuid not null | |
| description | text not null | |
| kind | income_kind not null | |
| expected_cents | bigint not null | positivo |
| receive_day | smallint not null | |
| frequency | frequency not null default 'monthly' | `one_off` cobre 13º, PLR, bônus |
| one_off_competence | text | obrigatório quando `frequency = 'one_off'` |

`check`: `frequency <> 'one_off' or one_off_competence is not null` — receita eventual sem competência não projeta em lugar nenhum e viraria linha órfã.
| starts_on / ends_on | date | |
| active | boolean not null default true | |

### budgets
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| period | text not null | `YYYY-MM` |
| category_id | uuid not null | |
| planned_cents | bigint not null | |

`unique (household_id, period, category_id)`

### goals
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| name | text not null | |
| target_cents | bigint not null | |
| target_date | date | |
| current_cents | bigint not null default 0 | |
| account_id | uuid references accounts(id) | se vinculada, `current_cents` vem do saldo |
| priority | integer not null default 100 | |
| status | goal_status not null default 'active' | |
| is_emergency_fund | boolean not null default false | alvo calculado, não digitado |

### investment_plans
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid not null | |
| name | text not null | |
| desired_monthly_income_cents | bigint not null | em R$ de hoje |
| current_portfolio_cents | bigint not null default 0 | |
| current_monthly_contribution_cents | bigint not null default 0 | |
| inflation_bp | integer not null default 450 | IPCA 4,50 % a.a. |
| income_tax_bp | integer not null default 1500 | 15 % |
| target_date | date | |
| created_at | timestamptz not null default now() | |

### investment_scenarios
| coluna | tipo | notas |
|---|---|---|
| investment_plan_id | uuid not null on delete cascade | |
| label | scenario_label not null | |
| real_return_bp | integer not null | retorno **real** a.a. na acumulação |
| withdrawal_bp | integer not null | taxa **real** a.a. de retirada perpétua |

`unique (investment_plan_id, label)`
Defaults ao criar plano: conservative 300/300 · moderate 500/400 · optimistic 700/500.

### household_settings
| coluna | tipo | notas |
|---|---|---|
| household_id | uuid primary key | |
| emergency_fund_months | smallint not null default 6 | |
| budget_warn_bp | integer not null default 8000 | semáforo amarelo em 80 % |
| projection_months | smallint not null default 12 | |
| commitment_months | smallint not null default 24 | |

### verification_token
Infraestrutura do Auth.js para o login por magic link (T-004). **Não é tabela de domínio** — nenhum dado financeiro mora aqui.
> Adicionada em 2026-09-16 pelo T-004 (decisão do próprio agente: o provider de e-mail do Auth.js exige persistir verification tokens), ratificada pelo orquestrador depois, na validação.

| coluna | tipo | notas |
|---|---|---|
| identifier | text not null | e-mail da allowlist (mapeia 1:1 para `members`) |
| token | text not null | **hash** SHA-256 de `${token}${secret}`, como o Auth.js grava; o valor em claro nunca chega ao banco |
| expires | timestamptz not null | TTL do link |

`primary key (identifier, token)`

> **Duas exceções deliberadas ao preâmbulo**, porque o contrato do adapter do Auth.js não as permite:
> - **sem `id`/`created_at`** — a PK é o par `(identifier, token)` e o ciclo de vida é o `expires`;
> - **sem `household_id`** — o token é criado **antes** de existir sessão. A fronteira de isolamento continua valendo para todo dado de domínio; aqui só mora o segredo efêmero do login.
>
> A linha é removida no primeiro uso (`useVerificationToken`), o que dá o single-use; tokens expirados e nunca usados são purgados no insert seguinte.

## 3. Seed obrigatório

1. 1 `household`, 2 `members` (e-mails da allowlist), 1 `household_settings`.
2. Árvore de categorias pt-BR. **Uma raiz por nome**, com `nature` na folha onde o lançamento cai (ver regra em `categories`):

| Raiz | `nature` da raiz | Filhas | `nature` das filhas |
|---|---|---|---|
| Moradia | essential | Aluguel/Financiamento, Condomínio, Luz, Água, Gás, Internet | essential |
| Alimentação | essential | Mercado | essential |
| | | Restaurantes, Delivery | **non_essential** |
| Transporte | essential | Combustível, Transporte público | essential |
| | | Aplicativos, Estacionamento | non_essential |
| Saúde | essential | Plano, Farmácia, Consultas | essential |
| Educação | essential | Escola, Cursos | essential |
| Impostos e taxas | essential | — | — |
| Seguros | essential | — | — |
| Lazer | non_essential | Viagens, Streaming, Eventos | non_essential |
| Vestuário | non_essential | — | — |
| Casa e decoração | non_essential | — | — |
| Presentes | non_essential | — | — |
| Cuidados pessoais | non_essential | — | — |
| Assinaturas | non_essential | — | — |
| Outros | non_essential | — | — |
| Investimentos | investment | Aportes, Reserva de emergência | investment |
| Receitas | income | Salário, Pró-labore, Renda variável, Aluguéis, Reembolsos, Outras receitas | income |

> "Alimentação" é o caso que revela a regra: uma raiz só, filhas de naturezas diferentes. A versão anterior deste documento listava o mesmo nome nas duas naturezas, o que dava a entender duas raízes homônimas — ambiguidade da spec, corrigida em 2026-09-10.

3. Regras de categorização iniciais para os comerciantes mais óbvios (mercados, postos, streamings) — 15 a 25 regras, apontando para a **folha** correta.
