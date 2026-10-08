# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Duas pessoas de um mesmo household (Ricardo e a esposa), que operam o app
igualmente: as duas importam faturas, categorizam, revisam e consultam, em
qualquer aparelho (desktop ou celular, via PWA). Não existe papel de "dono" e
"leitor". Não é SaaS: sem cadastro público, sem onboarding de desconhecidos,
allowlist fixa de 2 contas.

## Product Purpose

Controle e planejamento financeiro doméstico de um caixa único. O app serve
para:

1. **Controlar** o que já aconteceu: faturas de cartão, despesas fixas e receitas.
2. **Projetar** o que vem pela frente: parcelas futuras, recorrências e saldo dos próximos meses.
3. **Planejar** o longo prazo: aporte mensal para uma meta de renda passiva, em cenários conservador, médio e otimista.
4. **Visualizar**: o dashboard responde em 10 segundos "como estamos este mês e para onde estamos indo".

Sucesso: importar uma fatura leva menos de 2 minutos, e os dois confiam nos
números o bastante para decidir com base neles.

## Positioning

Projeção do comprometimento futuro, montada a partir das faturas reais
importadas (PDF, inclusive cifrado com senha, ou texto colado), sem nenhuma
credencial bancária no app e sem terceiros lendo o extrato. Toda projeção
mostra as premissas e deixa editá-las.

## Operating Context

- **Fechamento da fatura** (ritual mensal): importar os PDFs de Nubank,
  Santander e Mercado Pago, revisar linha a linha na tela de confirmação
  (data, valor, descrição, parcelamento, categoria, responsável, incluir ou
  excluir), conferir o total do lote contra o total da fatura e gravar.
- **Checagem rápida**: abrir o app por segundos, geralmente no celular, para
  ver como está o mês e o que já está comprometido nos próximos.
- Locale pt-BR, moeda BRL, fuso America/Sao_Paulo.

## Capabilities and Constraints

- Telas: Dashboard, Lançamentos, Importar, Cartões, Fluxo, Orçamento, Metas,
  Investimentos, Config (categorias e regras).
- Entrada de dados na v1: PDF com camada de texto (senha opcional, usada só em
  memória e nunca persistida) e texto colado, mais lançamento manual. CSV,
  XLS/XLSX e OFX ficam para a Fase 4 e são recusados com orientação.
- Nada é gravado sem confirmação explícita. Uma importação inteira pode ser
  desfeita em um clique. `raw_description` nunca é sobrescrita.
- Linhas que o parser não entende aparecem em branco e editáveis, com o texto
  original ao lado; nunca somem em silêncio. Entradas de baixa confiança
  mostram o nível de confiança.
- Dinheiro é inteiro de centavos; toda formatação monetária passa pelo
  componente `Money`.
- Stack existente: Next.js 15 (App Router), React 19, Tailwind CSS 3 com
  shadcn/ui, lucide-react, PostgreSQL via Drizzle, Auth.js com magic link.
- Código e schema em inglês; todo texto de interface em pt-BR.
- Especificação detalhada e decisões travadas em `docs/SPEC.md`.

## Brand Commitments

- Nome: **APPFIN**. Não existe logo nem identidade visual a preservar.
- Tom: pt-BR, direto, sem linguagem de marketing. É uma ferramenta privada da
  casa, não um produto à venda.

## Evidence on Hand

- Faturas reais dos três bancos (Nubank, Santander, Mercado Pago) já passaram
  pela tela de importação no aceite da Fase 1 (T-116). Os formatos estão
  descritos em `docs/IMPORT-SOURCES.md`.
- Não existem depoimentos, clientes, métricas públicas ou preços, e nada disso
  deve ser inventado.

## Product Principles

1. **Atrito zero.** Se uma tarefa recorrente exige digitar muito, o app falhou.
   A importação é o caminho principal, e a confirmação precisa ser rápida de
   revisar.
2. **Projeção acima do histórico.** O valor está no comprometimento dos
   próximos 12 meses, não em relatórios do passado.
3. **Números explícitos.** Toda projeção mostra as premissas usadas. Nada de
   cálculo fechado, e nenhum valor muda sem que dê para ver por quê.
4. **Duas pessoas, um caixa.** Tudo é compartilhado por padrão. A atribuição
   por pessoa é um atributo, não uma separação.
5. **Dados da casa.** Sem credencial bancária, sem terceiros, senha de PDF
   nunca persistida.
