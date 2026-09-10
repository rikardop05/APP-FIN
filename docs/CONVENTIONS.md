# CONVENTIONS — regras invioláveis

> **Este arquivo é obrigatório no contexto de todo agente que escreve código.**
> Regra que não está aqui não é convenção: é decisão do agente, e decisões divergentes entre agentes paralelos são o principal risco do projeto.

---

## 1. Idioma

| Onde | Idioma | Exemplo |
|------|--------|---------|
| Tabelas, colunas, tipos, funções, variáveis, arquivos | **inglês** | `transactions.amount_cents`, `futureCommitment()` |
| Textos visíveis ao usuário, labels, mensagens de erro de UI | **pt-BR** | `"Comprometimento futuro"`, `"Fatura sem cartão vinculado"` |
| Comentários e commits | **pt-BR** | |
| Enums no banco | inglês snake_case | `'credit_card_payment'` |

Nunca misturar. Nunca traduzir um identificador já existente no schema.

## 2. Dinheiro

- **Todo valor monetário é `bigint` de centavos.** Coluna sempre com sufixo `_cents`.
- **`number` com decimal é proibido para dinheiro.** Sem exceção, sem "só nesse cálculo".
- Tipo TypeScript: `type Cents = number & { readonly __brand: 'Cents' }` (inteiro; safe integer cobre R$ 90 trilhões).
- Conversão para/de string acontece **só na borda**: `formatBRL()` na exibição, `parseBRL()` na entrada. Nenhum outro lugar formata.
- Sinal: **saída de dinheiro é negativa, entrada é positiva.** Uma convenção só, em todo o sistema, inclusive nos parsers.
- Arredondamento: só em divisão de parcelas, via `allocate()` — distribui o resto nas primeiras parcelas para que a soma feche exatamente com o total.

## 3. Taxas e percentuais

- Armazenados como **inteiro em basis points** (`_bp`), nunca float. `500 bp = 5,00 %`. Coluna sempre com sufixo `_bp`.
- Conversão para decimal só dentro do cálculo: `bp / 10_000`.
- Capitalização: **sempre composta**. Converter taxa anual para mensal com `(1 + r) ** (1/12) - 1`. **Dividir por 12 é bug**, não simplificação.

## 4. Datas

- Data de fato financeiro (compra, vencimento, recebimento): coluna `date`, sem hora. Tipo TS: `string` no formato `YYYY-MM-DD`.
- Timestamp de sistema (`created_at`): `timestamptz`, gravado em UTC.
- Exibição sempre convertida para `America/Sao_Paulo`.
- **Competência** (mês de referência): `string` `'YYYY-MM'`, tipo `Competence`. É o eixo de todo relatório de gasto.
- **O proibido em `/lib` é ler o relógio**, não construir data: `new Date()` sem argumentos, `Date.now()` e `new Date(Date.now())` são proibidos. Função pura recebe a data como parâmetro (`today: string`) — é o que torna o teste determinístico.
- **Construir data a partir de valores explícitos é permitido e necessário** (`new Date(Date.UTC(y, m, d))`), mas **só dentro de `lib/date`**, que é o único lugar do sistema com aritmética de calendário. `lib/finance` e `lib/import` chamam `lib/date`; não constroem data nem fazem conta de mês por si.

## 5. Camadas

```
/lib/money, /lib/date        primitivos, puros
/lib/finance/*               motor de cálculo, PURO
/lib/import/*                parsers, PURO
/lib/db/*                    schema Drizzle + queries — único lugar com SQL
/app/api/*                   rotas HTTP: validam com Zod, chamam /lib, persistem
/app/(app)/*                 telas
/components/*                UI reutilizável
```

**Regra dura:** nada em `/lib/finance` e `/lib/import` importa `/lib/db`, `next/*`, `fs`, `fetch` ou lê `process.env`. São funções que recebem dados e devolvem dados. Um agente que precise quebrar isso está resolvendo o problema no lugar errado — deve parar e reportar, não adaptar.

## 6. Validação

- Um schema Zod por fronteira: formulário, corpo de rota, linha de arquivo importado.
- Tipos derivam do Zod (`z.infer`), não são escritos duas vezes.
- `any` é proibido. `as` só com comentário justificando na linha acima.
- `strict: true` no tsconfig. Build com erro de tipo não é entrega.

## 7. Banco

- Toda alteração de schema é uma **migration versionada** gerada pelo Drizzle. Editar migration já aplicada é proibido.
- Toda query filtra por `household_id`. Sem exceção — é a fronteira de isolamento.
- Importação de arquivo roda em **uma transação**: ou entra o lote inteiro, ou nada.
- `ON DELETE`: `cascade` de `household` para baixo; `restrict` em `category_id` e `credit_card_id` referenciados por transação.

## 8. Testes

- Obrigatório em `/lib/finance` e `/lib/import`: toda função exportada tem teste.
- Fórmula financeira precisa de teste **com valor conferido à mão** no próprio teste (comentário com a conta), não só "não quebrou".
- Casos de borda obrigatórios: taxa zero, aporte zero, meta já atingida, parcela que não divide exato, mês de 28/30/31 dias, dia de fechamento 29–31, arquivo vazio, arquivo com linha corrompida, valor negativo onde se espera positivo.
- Parser tem fixture: arquivo de exemplo **anonimizado** em `/lib/import/__fixtures__/`.
- UI não tem exigência de cobertura.

## 9. Segredos e privacidade

- Segredo só em variável de ambiente, nunca em código, nunca em arquivo versionado.
- Dado financeiro **não sai da aplicação**: sem analytics de terceiros, sem log de descrição de transação em serviço externo, sem envio de arquivo importado para fora.
- Fixture de teste é sempre anonimizada.
- **Arquivo real de banco (fatura, extrato) nunca entra em caminho versionado.** O bruto mora em `.private/`, que está no `.gitignore`; só a versão anonimizada vai para `lib/import/__fixtures__/`. Estes arquivos carregam nome completo, dígitos de cartão e endereço, e uma vez commitados saem do histórico só com reescrita de história.
- Anonimização de arquivo real é feita por agente Claude ou pelo humano, **nunca** por agente em provedor de terceiro.

## 10. Dependências

- Instalar pacote novo fora da lista aprovada (SPEC §2.1) exige registrar o motivo na entrega da tarefa.
- Não trocar biblioteca já escolhida por preferência. Se a escolhida não resolve, reportar e parar.

## 11. O que um agente nunca faz sozinho

1. Alterar `/docs/*` (spec, contratos, plano) — só o orquestrador, e apenas quando o humano aprova.
2. Alterar arquivo que não está na sua lista de posse (BUILD-PLAN).
3. Rodar migration destrutiva (`drop`, `truncate`) sem instrução explícita.
4. Mudar convenção deste arquivo.
5. Marcar tarefa como concluída com teste vermelho ou erro de tipo.
6. Reinterpretar requisito ambíguo: consultar a tabela de defaults (ORCHESTRATION §5); se não estiver lá, reportar o bloqueio.
