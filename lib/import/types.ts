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
  /** Data do fato financeiro, `'YYYY-MM-DD'`. Nunca com hora. */
  occurredOn: IsoDate;
  /** Descricao como veio da origem, sem limpeza. E o que a UI mostra ao lado da editada. */
  rawDescription: string;
  /** Valor em centavos, com sinal. */
  amountCents: Cents;
  /**
   * Identificador unico da transacao na origem. Existe so no OFX (`FITID`), que
   * e Fase 4 (T-106): na v1 vem sempre ausente ou `null`. Fica declarado porque
   * o contrato o declara e o dedupe do T-103 ja o considera quando presente.
   */
  fitId?: string | null;
  /** Parcela reconhecida por `detectInstallment` (T-121), quando ha padrao. */
  installment?: { current: number; total: number } | null;
}

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
 * O que todo parser devolve, qualquer que seja a origem.
 *
 * `reportedTotalCents` e o total **impresso** no documento (o "total desta
 * fatura"), nao a soma das linhas. Os dois sao comparados no
 * `reconcileStatement` (CONTRACTS §3) e a diferenca aparece na confirmacao —
 * e o que denuncia linha perdida por mudanca de layout. `null` quando a origem
 * nao imprime total, que e o caso do texto colado.
 */
export interface ParseResult {
  rows: ParsedRow[];
  diagnostics: ParseDiagnostic[];
  reportedTotalCents: Cents | null;
}
