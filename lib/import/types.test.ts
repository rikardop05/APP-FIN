import { describe, expect, it } from 'vitest';

import { toCompetence, type IsoDate } from '@/lib/date';
import { addCents, cents, parseBRL, type Cents } from '@/lib/money';

import type { ParseDiagnostic, ParseResult, ParsedRow } from '@/lib/import/types';

/**
 * `types.ts` nao exporta funcao, entao nao ha comportamento a testar. O que
 * este arquivo protege e o aceite do T-120 — "os tipos compoem com `Cents` e
 * `IsoDate`" — e ele falha em tempo de compilacao (`npm run typecheck`), nao em
 * tempo de execucao: se `ParsedRow.amountCents` deixar de compor com `Cents`, ou
 * `occurredOn` com `IsoDate`, o arquivo para de compilar.
 *
 * `occurredOn` e `amountCents` sao anulaveis (CONTRACTS §15): `null` e ausente,
 * `cents(0)` e R$ 0,00 real. As asercoes de runtime existem para o `vitest` ter
 * o que rodar e para fixar a convencao de sinal (CONVENTIONS §2: saida
 * negativa, entrada positiva).
 */

/**
 * Extrai do fixture um campo que **tem de** estar preenchido. Lanca se vier
 * `null` — nada de `!` nem `as`: uma assercao non-null apagaria a garantia que a
 * anulabilidade comprou, e o proximo bug passaria em silencio. Se o fixture
 * deixar de produzir o valor, o teste falha ruidosamente aqui.
 */
function required<T>(value: T | null, field: string): T {
  if (value === null) throw new Error(`fixture sem ${field}`);
  return value;
}

/** Uma linha como um parser da v1 a produz. */
function buildRow(): ParsedRow {
  const amountCents = parseBRL('-R$ 1.234,56');
  if (amountCents === null) throw new Error('fixture invalida');

  return {
    occurredOn: '2026-09-10',
    rawDescription: 'NETFLIX.COM',
    amountCents,
    fitId: null,
    installment: { current: 3, total: 10 },
  };
}

describe('ParsedRow', () => {
  it('compoe com Cents de lib/money e IsoDate de lib/date', () => {
    const row = buildRow();

    // `IsoDate` entra em lib/date sem conversao: e o mesmo tipo dos dois lados.
    const occurredOn: IsoDate = required(row.occurredOn, 'occurredOn');
    expect(toCompetence(occurredOn)).toBe('2026-09');

    // `Cents` entra na aritmetica de dinheiro sem conversao, pelo mesmo motivo.
    const amount: Cents = required(row.amountCents, 'amountCents');
    expect(addCents(amount, cents(56))).toBe(-123400);
  });

  it('carrega o sinal da convencao do sistema: saida negativa', () => {
    expect(buildRow().amountCents).toBeLessThan(0);
  });

  it('aceita linha sem parcela e sem fitId — o caso comum da v1', () => {
    const row: ParsedRow = {
      occurredOn: '2026-09-01',
      rawDescription: 'PAGAMENTO RECEBIDO',
      amountCents: cents(50_000),
    };
    expect(row.fitId).toBeUndefined();
    expect(row.installment).toBeUndefined();
  });
});

describe('ParseResult', () => {
  it('leva linhas, diagnosticos e o total impresso no documento', () => {
    const diagnostic: ParseDiagnostic = {
      line: 42,
      message: 'Valor ilegível nesta linha.',
      raw: '10/09  NETFLIX.COM  R$ ??',
    };
    const result: ParseResult = {
      rows: [buildRow()],
      diagnostics: [diagnostic],
      reportedTotalCents: cents(-123_456),
    };

    // Linha corrompida vira diagnostico e nao apaga o resto do arquivo.
    expect(result.rows).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(42);
    expect(result.reportedTotalCents).toBe(-123_456);
  });

  it('aceita total ausente, que e o caso do texto colado', () => {
    const result: ParseResult = { rows: [], diagnostics: [], reportedTotalCents: null };
    expect(result.reportedTotalCents).toBeNull();
  });
});
