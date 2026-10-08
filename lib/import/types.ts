/**
 * Tipos compartilhados da importacao — CONTRACTS §15, parte de tipos (T-120).
 *
 * Pre-requisito de todo parser: PDF (T-117/b/c), texto colado (T-119) e o
 * pipeline (T-107) falam entre si por estes tres tipos. Eles sao o unico
 * vocabulario comum entre quem le um arquivo e quem grava um lancamento, e por
 * isso moram num modulo sem logica: mudar um campo aqui quebra tres parsers
 * escritos em paralelo.
 *
 * Duas decisoes que valem registro, porque parecem omissao:
 *
 * 1. **Nao ha `ColumnMap` nem `ImportMapping`.** Sao o vocabulario de
 *    mapeamento de coluna do CSV/XLSX (T-105, T-118), adiados para a Fase 4
 *    junto com os dois parsers. Nenhum consumidor da v1 os le, e tipo declarado
 *    sem consumidor convida alguem a construir a maquinaria por completude.
 *
 * 2. **Este modulo nao exporta funcao.** Nao valida, nao normaliza, nao
 *    constroi: quem produz `Cents` e `cents`/`parseBRL` de `lib/money`, e quem
 *    produz `IsoDate` sao os parsers, sobre `lib/date`. Um construtor aqui
 *    duplicaria validacao ja existente em dois lugares.
 *
 * Modulo puro (CONVENTIONS §5): nada de `lib/db`, `next/*`, `fs`, `fetch` nem
 * `process.env`. So tipo.
 */

import type { IsoDate } from '@/lib/date';
import type { Cents } from '@/lib/money';

/**
 * Uma linha lida de um arquivo ou de um texto colado, **antes** da confirmacao
 * do usuario. Nao e um lancamento: e o que o parser conseguiu entender.
 *
 * O que sera gravado e a linha CONFIRMADA (`ConfirmedRow`, CONTRACTS §16) —
 * competencia e `dedupe_hash` sao calculados depois da edicao, no
 * `finalizeImport`, e por isso nao existem aqui.
 *
 * `amountCents` ja vem com o sinal da convencao do sistema (CONVENTIONS §2):
 * **saida negativa, entrada positiva**. Quem aplica a direcao e o parser, que
 * sabe se a linha e debito ou credito; `parseBRL` devolve o sinal literal e nao
 * chuta.
 */
export interface ParsedRow {
  /**
   * Data do fato financeiro, `'YYYY-MM-DD'`. `null` = **nao lida na origem**: o
   * usuario completa na tela de confirmacao antes de qualquer gravacao.
   */
  occurredOn: IsoDate | null;
  /** Descricao como veio da origem, sem limpeza. E o que a UI mostra ao lado da editada. */
  rawDescription: string;
  /**
   * Valor em centavos, com sinal, ou `null` quando nao lido. **NAO confundir
   * `null` com `cents(0)`**: zero e um valor legitimo (uma compra de R$ 0,00
   * existe), entao o ausente precisa de um estado proprio.
   */
  amountCents: Cents | null;
  /**
   * Identificador unico da transacao na origem. Existe so no OFX (`FITID`), que
   * e Fase 4 (T-106): na v1 vem sempre ausente ou `null`. Fica declarado porque
   * o contrato o declara e o dedupe do T-103 ja o considera quando presente.
   */
  fitId?: string | null;
  /** Parcela reconhecida por `detectInstallment` (T-121), quando ha padrao. */
  installment?: { current: number; total: number } | null;
  /**
   * `true` quando a linha e o **pagamento da fatura anterior** (RF-CC-04): ela
   * pertence a CONTA bancaria (`kind = credit_card_payment`), nao ao cartao.
   * Importada pelo cartao, contaria duas vezes quando o extrato da conta entrar.
   *
   * **RATIFICADO pelo Orquestrador em 2026-09-30**, no gate T-116. Campo aditivo
   * e opcional: `undefined`/`false` = lancamento normal. Reconhecido no parser
   * (que conhece o layout do banco) e virado em estado no pipeline.
   *
   * A prova de que a linha nao pertence a fatura: excluindo-a, as duas faturas
   * reais fecham no centavo com o total que elas mesmas imprimem (Mercado Pago
   * 17 linhas = R$ 1.469,01; Nubank 14 linhas = R$ 1.074,82). Incluindo-a, o MP
   * erra por exatamente o valor do pagamento.
   *
   * **Divida conhecida:** os bancos imprimem essa linha com sinais opostos (o
   * Nubank com `-`, o Mercado Pago sem sinal), entao o valor sai positivo num e
   * negativo no outro. Nao afeta a v1, porque a linha chega desmarcada e
   * `credit_card_payment` fica fora de despesa e de receita (RC-03). Uniformizar
   * antes de qualquer uso do valor.
   */
  creditCardPayment?: boolean;
  /**
   * `true` quando a linha e **informativa**: valor impresso R$ 0,00 (ex.: a
   * `ANUIDADE DIFERENCIADA` isenta do Santander, impressa com parcela 01/12).
   * Decisao 8 do Ricardo, 2026-10-07: zero nao e despesa nem receita, entao a
   * linha nao vira lancamento nem plano de parcelas.
   *
   * Mesmo desenho de `creditCardPayment`: campo aditivo e opcional, o parser so
   * REPORTA o que leu; a consequencia e do pipeline. `amountCents === null`
   * (valor nao lido) NAO e informativo — e campo a completar.
   */
  informational?: boolean;
}

/**
 * Nulabilidade de `occurredOn` e `amountCents` — CONTRACTS §15, fixada em
 * 2026-09-16 a partir do achado do T-119.
 *
 * A regra "nenhuma linha e descartada em silencio" obriga a devolver a linha
 * que o parser nao leu por inteiro. Com os campos obrigatorios, a unica saida
 * era um sentinela (`''` e `cents(0)`) — e sentinela aqui mente de duas formas:
 *
 * 1. `cents(0)` e um valor legitimo, entao zero ficaria ambiguo entre "nao li"
 *    e "li e e zero";
 * 2. `''` nao e `IsoDate` valido, e `billingPeriodFor('')` lanca longe da
 *    causa, em runtime, no meio da importacao.
 *
 * Com `null` o compilador **obriga** todo consumidor (T-107, T-108, T-111) a
 * tratar o caso ausente: erro de compilacao em vez de bug silencioso.
 * Consequencia: linha com `occurredOn` ou `amountCents` `null` nao pode ser
 * gravada — ou o usuario completa na confirmacao, ou ele a exclui do lote.
 */

/**
 * Um problema encontrado em UMA linha, que **nao** aborta o arquivo.
 *
 * A regra da area (CONVENTIONS §8, caso de borda obrigatorio) e que linha
 * corrompida vira diagnostico e o resto do arquivo segue sendo lido. Silencio e
 * o unico desfecho proibido: ou a linha entra em `rows`, ou ela aparece aqui.
 */
export interface ParseDiagnostic {
  /**
   * Numero da linha na origem, contando a partir de 1. Quando a origem nao tem
   * linha (PDF remontado por coordenada), e o indice da linha reconstruida.
   */
  line: number;
  /** Mensagem em pt-BR, exibida ao usuario na tela de confirmacao. */
  message: string;
  /** Conteudo original da linha, preservado para o usuario reconhecer o que falhou. */
  raw: string;
}

/**
 * O que a data impressa no documento **e**, para a tela escrever a frase certa.
 *
 * `'due_date'` = vencimento; `'statement_date'` = data de referencia da propria
 * fatura (quando o documento nao imprime o vencimento). Nao e preciosismo: a tela
 * vai dizer ao humano "este documento diz <data>, voce declarou <competencia>", e
 * comparar um vencimento com uma competencia e comparar um mes possivelmente
 * seguinte ao do fechamento. Um campo anonimo obrigaria quem le a adivinhar o
 * tipo por banco — o mesmo erro do `moneyToken` em triplicata.
 */
export type DocumentDateKind = 'due_date' | 'statement_date';

/** Data de referencia impressa no documento, com o seu significado. */
export interface DocumentDate {
  /** A data, `'YYYY-MM-DD'`. */
  date: IsoDate;
  /** O que essa data e. */
  kind: DocumentDateKind;
}

/**
 * O que todo parser devolve, qualquer que seja a origem.
 *
 * `reportedTotalCents` e o total **impresso** no documento (o "total desta
 * fatura"), nao a soma das linhas. Os dois sao comparados no
 * `reconcileStatement` (CONTRACTS §3) e a diferenca aparece na confirmacao —
 * e o que denuncia linha perdida por mudanca de layout. `null` quando a origem
 * nao imprime total, que e o caso do texto colado.
 *
 * `documentDate` e a data de referencia que o documento imprime (vencimento, ou
 * a data da fatura), com o seu `kind`. A competencia continua DECLARADA pelo
 * usuario; o documento so levanta a mao para a tela avisar quando as duas
 * divergem (avisa, nao bloqueia). Ausente/`null` quando a origem nao traz data
 * (texto colado), por isso e opcional.
 */
export interface ParseResult {
  rows: ParsedRow[];
  diagnostics: ParseDiagnostic[];
  reportedTotalCents: Cents | null;
  documentDate?: DocumentDate | null;
}
