import { describe, expect, it } from 'vitest';

import { cents } from '@/lib/money';
import { parsePastedText } from '@/lib/import/text';
import type { TextParseOptions, TextParsedRow } from '@/lib/import/text';

/**
 * Fixtures **sinteticas**, inventadas para este teste. Nenhum dado real de
 * familia passa por aqui (RNF-01): os nomes de loja e os valores sao ficticios.
 */

/** Le uma linha unica e devolve a linha parseada, para os testes de detalhe. */
function onlyRow(raw: string, opts?: TextParseOptions): TextParsedRow {
  const result = parsePastedText(raw, opts);
  expect(result.rows).toHaveLength(1);
  const row = result.rows[0];
  if (row === undefined) throw new Error('fixture sem linha parseada');
  return row;
}

describe('parsePastedText — os quatro padroes de parcela', () => {
  const opts: TextParseOptions = { defaultCompetence: '2026-09' };

  it('reconhece PARC 03/10 sem perder data nem valor', () => {
    const row = onlyRow('10/09/2026 LOJA SINTETICA PARC 03/10 R$ 50,00', opts);
    expect(row.occurredOn).toBe('2026-09-10');
    expect(row.amountCents).toBe(5000);
    expect(row.rawDescription).toBe('LOJA SINTETICA PARC 03/10');
    expect(row.installment).toEqual({ current: 3, total: 10 });
    expect(row.missing).toEqual([]);
    expect(row.confidence).toBe('high');
  });

  it('reconhece 03/10 solto', () => {
    const row = onlyRow('10/09/2026 LOJA SINTETICA 03/10 R$ 50,00', opts);
    expect(row.installment).toEqual({ current: 3, total: 10 });
    expect(row.rawDescription).toBe('LOJA SINTETICA 03/10');
    expect(row.amountCents).toBe(5000);
  });

  it('reconhece PARCELA 3 DE 10', () => {
    const row = onlyRow('10/09/2026 LOJA SINTETICA PARCELA 3 DE 10 R$ 50,00', opts);
    expect(row.installment).toEqual({ current: 3, total: 10 });
    // A guarda do `N de M` impede que o `3` ou o `10` virem valor da linha.
    expect(row.amountCents).toBe(5000);
  });

  it('reconhece (3 de 10) e nao confunde os numeros com o valor', () => {
    const row = onlyRow('10/09/2026 LOJA SINTETICA (3 de 10) R$ 50,00', opts);
    expect(row.installment).toEqual({ current: 3, total: 10 });
    expect(row.amountCents).toBe(5000);
  });

  it('data completa na descricao nao vira parcela', () => {
    const row = onlyRow('10/09/2026 LOJA SINTETICA COMPRA EM 03/10/2026 R$ 50,00', opts);
    expect(row.installment).toBeNull();
    expect(row.occurredOn).toBe('2026-09-10');
  });
});

describe('parsePastedText — data', () => {
  it('le dd/mm/aaaa', () => {
    const row = onlyRow('10/09/2026 LOJA SINTETICA 50,00');
    expect(row.occurredOn).toBe('2026-09-10');
    expect(row.missing).toEqual([]);
    expect(row.confidence).toBe('high');
  });

  it('le aaaa-mm-dd', () => {
    const row = onlyRow('2026-09-10 LOJA SINTETICA 50,00');
    expect(row.occurredOn).toBe('2026-09-10');
    expect(row.confidence).toBe('high');
  });

  it('le dd/mm usando o ano de defaultCompetence', () => {
    const row = onlyRow('10/09 LOJA SINTETICA 50,00', {
      defaultCompetence: '2026-09',
    });
    expect(row.occurredOn).toBe('2026-09-10');
    // O ano foi inferido: completo, mas nao "high".
    expect(row.confidence).toBe('medium');
    expect(row.missing).toEqual([]);
  });

  it('le dd mmm abreviado e por extenso, com e sem ano', () => {
    expect(onlyRow('10 set LOJA SINTETICA 50,00', { defaultCompetence: '2026-01' }).occurredOn).toBe(
      '2026-09-10',
    );
    expect(onlyRow('10 de setembro de 2026 LOJA SINTETICA 50,00').occurredOn).toBe('2026-09-10');
  });

  it('respeita dateOrder no formato numerico de duas partes', () => {
    const opts = { defaultCompetence: '2026-01' } as const;
    expect(onlyRow('10/09 LOJA SINTETICA 50,00', opts).occurredOn).toBe('2026-09-10');
    expect(
      onlyRow('10/09 LOJA SINTETICA 50,00', { ...opts, dateOrder: 'mdy' }).occurredOn,
    ).toBe('2026-10-09');
  });

  it('le aaaa/mm/dd (dateOrder ymd nao e so a forma com hifen)', () => {
    const row = onlyRow('2026/09/10 LOJA SINTETICA 50,00', { dateOrder: 'ymd' });
    expect(row.occurredOn).toBe('2026-09-10');
    expect(row.confidence).toBe('high');
  });

  it('nao chuta o seculo de dd/mm/aa: data sem ano, linha preservada', () => {
    const row = onlyRow('10/09/26 LOJA SINTETICA 50,00', { defaultCompetence: '2026-09' });
    expect(row.occurredOn).toBeNull();
    expect(row.missing).toContain('date');
    expect(row.confidence).toBe('low');
    expect(row.sourceLine).toBe('10/09/26 LOJA SINTETICA 50,00');
  });

  it('data sem ano e sem defaultCompetence vira missing, nunca ano inventado', () => {
    const result = parsePastedText('10/09 LOJA SINTETICA 50,00');
    const row = onlyRow('10/09 LOJA SINTETICA 50,00');
    expect(row.occurredOn).toBeNull();
    expect(row.missing).toEqual(['date']);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('ano');
  });

  it('data inexistente no calendario vira diagnostic e nao aborta o lote', () => {
    const raw = [
      '10/09/2026 LOJA SINTETICA 50,00',
      '31/02/2026 FARMACIA EXEMPLO 20,00',
      '11/09/2026 PADARIA MODELO 10,00',
    ].join('\n');

    const result = parsePastedText(raw);

    expect(result.rows).toHaveLength(3);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(2);
    expect(result.diagnostics[0]?.raw).toBe('31/02/2026 FARMACIA EXEMPLO 20,00');

    // A linha corrompida continua no lote, marcada e com o texto original.
    const corrupt = result.rows[1];
    expect(corrupt?.confidence).toBe('low');
    expect(corrupt?.missing).toContain('date');
    expect(corrupt?.occurredOn).toBeNull();
    expect(corrupt?.sourceLine).toBe('31/02/2026 FARMACIA EXEMPLO 20,00');

    // E as linhas seguintes continuam sendo lidas.
    expect(result.rows[2]?.occurredOn).toBe('2026-09-11');
    expect(result.rows[2]?.confidence).toBe('high');
  });
});

describe('parsePastedText — valor', () => {
  // Conferido a mao: 1.234,56 = 1234 reais e 56 centavos = 123456 centavos.
  it('le R$ com ponto de milhar e virgula decimal', () => {
    expect(onlyRow('10/09/2026 LOJA SINTETICA R$ 1.234,56').amountCents).toBe(123456);
  });

  it('le milhar e virgula sem o simbolo R$', () => {
    expect(onlyRow('10/09/2026 LOJA SINTETICA 1.234,56').amountCents).toBe(123456);
  });

  it('preserva sinal nas tres formas comuns de negativo', () => {
    expect(onlyRow('10/09/2026 LOJA SINTETICA -R$ 1.234,56').amountCents).toBe(-123456);
    expect(onlyRow('10/09/2026 LOJA SINTETICA R$ -1.234,56').amountCents).toBe(-123456);
    // Sinal a direita ("invertido", convencao de extrato).
    expect(onlyRow('10/09/2026 LOJA SINTETICA 1.234,56-').amountCents).toBe(-123456);
  });

  it('valor malformado vira diagnostic e linha low', () => {
    const result = parsePastedText('10/09/2026 LOJA SINTETICA 12,345');
    const row = result.rows[0];
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('Valor');
    expect(row?.amountCents).toBeNull();
    expect(row?.missing).toContain('amount');
    expect(row?.confidence).toBe('low');
  });

  it('linha sem valor volta com missing amount, sem descartar a data', () => {
    const row = onlyRow('10/09/2026 LOJA SINTETICA');
    expect(row.occurredOn).toBe('2026-09-10');
    expect(row.amountCents).toBeNull();
    expect(row.missing).toEqual(['amount']);
    expect(row.confidence).toBe('low');
  });

  it('R$ 0,00 real e zero, nao null — a distincao que o sentinela nao fazia', () => {
    // Sem a anulabilidade, zero e "nao li" seriam o mesmo valor. Aqui o parser
    // leu: a compra existe e vale exatamente R$ 0,00.
    const row = onlyRow('10/09/2026 LOJA SINTETICA R$ 0,00');
    expect(row.amountCents).toBe(cents(0));
    expect(row.amountCents).not.toBeNull();
    expect(row.confidence).toBe('high');
    expect(row.missing).toEqual([]);
  });

  it('nao le numero colado a palavra como valor', () => {
    const row = onlyRow('10/09/2026 LOJA SINTETICA ABC123 50,00');
    expect(row.amountCents).toBe(5000);
    expect(row.rawDescription).toBe('LOJA SINTETICA ABC123');
  });
});

describe('parsePastedText — nenhuma linha descartada', () => {
  it('texto vazio devolve resultado vazio', () => {
    expect(parsePastedText('')).toEqual({ rows: [], diagnostics: [], reportedTotalCents: null });
    expect(parsePastedText('   \n\t\n  ')).toEqual({
      rows: [],
      diagnostics: [],
      reportedTotalCents: null,
    });
  });

  it('so cabecalho rende linhas de baixa confianca, nenhuma em silencio', () => {
    const raw = [
      'FATURA DO CARTAO VENCIMENTO 10/09/2026',
      'PAGINA 1 DE 3',
      'TOTAL R$ 1.234,56',
    ].join('\n');

    const result = parsePastedText(raw);

    expect(result.rows).toHaveLength(3);
    expect(result.diagnostics).toHaveLength(0);
    for (const row of result.rows) {
      expect(row.confidence).toBe('low');
      expect(row.missing.length).toBeGreaterThan(0);
      // O texto original vai sempre na linha, para a tela mostrar ao lado.
      expect(row.sourceLine.length).toBeGreaterThan(0);
    }
  });

  it('todo cabecalho de fatura sintetico vira linha, nao some', () => {
    // Dump inventado com cabecalho, rodape e uma transacao de verdade.
    const raw = [
      'FATURA SINTETICA — SETEMBRO 2026',
      'Portador: NOME FICTICIO',
      'Vencimento 10/09/2026',
      '',
      '10/09 LOJA SINTETICA R$ 50,00',
      '11/09 PADARIA MODELO 10,00',
      'Nao ha outras transacoes',
    ].join('\n');

    const result = parsePastedText(raw, { defaultCompetence: '2026-09' });
    const nonBlank = raw.split('\n').filter((line) => line.trim() !== '');

    // A anotacao explicita le a interseccao do contrato como linhas de texto.
    const rows: TextParsedRow[] = result.rows;

    expect(rows).toHaveLength(nonBlank.length);
    expect(rows.map((row) => row.sourceLine)).toEqual(nonBlank);
    // As duas transacoes sairam completas; o ruido ficou marcado como low.
    expect(rows[3]?.amountCents).toBe(5000);
    expect(rows[4]?.amountCents).toBe(1000);
    expect(rows[0]?.confidence).toBe('low');
  });

  it('aceita CRLF e conta a linha corrompida pela posicao fisica', () => {
    const raw = '10/09/2026 LOJA 50,00\r\n\r\n32/13/2026 RUIM 10,00\r\n11/09/2026 LOJA 10,00';
    const result = parsePastedText(raw);

    expect(result.rows).toHaveLength(3);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(3);
  });

  it('preserva sourceLine exatamente, com espacos internos', () => {
    const line = '10/09/2026   LOJA    SINTETICA    50,00';
    const row = onlyRow(line);
    expect(row.sourceLine).toBe(line);
    expect(row.rawDescription).toBe('LOJA SINTETICA');
  });

  it('nunca devolve total impresso — texto colado nao traz um', () => {
    expect(parsePastedText('10/09/2026 LOJA 50,00').reportedTotalCents).toBeNull();
  });
});

describe('parsePastedText — confianca e faltantes', () => {
  it('high quando data, valor e descricao estao completos', () => {
    const row = onlyRow('10/09/2026 LOJA SINTETICA 50,00');
    expect(row.confidence).toBe('high');
    expect(row.missing).toEqual([]);
  });

  it('medium quando so falta a descricao', () => {
    const row = onlyRow('10/09/2026 50,00');
    expect(row.missing).toEqual(['description']);
    expect(row.confidence).toBe('medium');
    expect(row.rawDescription).toBe('');
  });

  it('low quando falta data ou valor, com o campo faltante listado', () => {
    expect(onlyRow('LOJA SINTETICA 50,00').missing).toEqual(['date']);
    expect(onlyRow('10/09/2026 LOJA SINTETICA').missing).toEqual(['amount']);
    expect(onlyRow('LINHA SO COM TEXTO').missing).toEqual(['date', 'amount']);
  });
});

describe('parsePastedText — achados da revisao (Corvo)', () => {
  it('N/M ambiguo como UNICO candidato vira data, nao parcela (caso do Lanterna)', () => {
    // '01/09 UBER -25,50': se virasse parcela, a linha ficaria SEM data e
    // projetaria 9 meses de despesa inexistente. Errar para data e recuperavel;
    // a linha sai com baixa confianca e o texto bruto visivel (sourceLine).
    const result = parsePastedText('01/09 UBER -25,50', { defaultCompetence: '2026-09' });
    const row = result.rows[0];
    expect(row?.occurredOn).toBe('2026-09-01');
    expect(row?.installment).toBeNull();
    expect(row?.amountCents).toBe(-2550);
    expect(row?.rawDescription).toBe('UBER');
    expect(row?.confidence).toBe('low');
    expect(row?.sourceLine).toBe('01/09 UBER -25,50');
  });

  it('N/M ambiguo com OUTRA data presente continua sendo parcela', () => {
    const row = onlyRow('10/09/2026 MERCADO LIVRE 03/10 R$ 50,00');
    expect(row.occurredOn).toBe('2026-09-10');
    expect(row.installment).toEqual({ current: 3, total: 10 });
    expect(row.confidence).toBe('high');
  });

  it('N/M ambiguo unico e sem defaultCompetence: nao ha ano para datar', () => {
    // Sem competencia nao da para montar a data: a linha fica sem data, nunca
    // com um ano inventado. O N/M permanece na descricao e continua parcela.
    const result = parsePastedText('MERCADO LIVRE 03/10 50,00');
    const row = result.rows[0];
    expect(row?.occurredOn).toBeNull();
    expect(row?.missing).toContain('date');
    expect(row?.confidence).toBe('low');
    expect(row?.rawDescription).toBe('MERCADO LIVRE 03/10');
    expect(row?.installment).toEqual({ current: 3, total: 10 });
  });

  it('fallback nao engole o diagnostico de outra data invalida na linha', () => {
    // `31/04` nao existe (problem); `05/09` fecha como parcela (fallback). A
    // linha e datada pelo fallback, mas o aviso da data invalida continua.
    const result = parsePastedText('31/04 05/09 LOJA SINTETICA 50,00', {
      defaultCompetence: '2026-09',
    });
    const row = result.rows[0];
    expect(row?.occurredOn).toBe('2026-09-05');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('31/04');
  });

  it('fallback perde para uma data segura posterior na linha', () => {
    // `03/10` ambiguo vem primeiro, mas a data completa `10/09/2026` vence.
    const row = onlyRow('03/10 MERCADO SINTETICO 10/09/2026 R$ 50,00');
    expect(row.occurredOn).toBe('2026-09-10');
    expect(row.installment).toEqual({ current: 3, total: 10 });
    expect(row.confidence).toBe('high');
  });

  it('PARC protege o N/M mesmo sendo unico: nao vira fallback', () => {
    const result = parsePastedText('PARC 03/10 UBER -25,50', { defaultCompetence: '2026-09' });
    const row = result.rows[0];
    expect(row?.occurredOn).toBeNull();
    expect(row?.missing).toContain('date');
    expect(row?.installment).toEqual({ current: 3, total: 10 });
  });

  it('dateOrder ymd nao cria candidato dd/mm: o N/M fica na descricao', () => {
    const row = onlyRow('03/10 LOJA SINTETICA 50,00', {
      dateOrder: 'ymd',
      defaultCompetence: '2026-09',
    });
    expect(row.occurredOn).toBeNull();
    expect(row.missing).toContain('date');
    expect(row.installment).toEqual({ current: 3, total: 10 });
  });

  it('dateOrder mdy inverte dia/mes no fallback', () => {
    const row = onlyRow('03/10 LOJA SINTETICA 50,00', {
      dateOrder: 'mdy',
      defaultCompetence: '2026-09',
    });
    expect(row.occurredOn).toBe('2026-03-10');
    expect(row.installment).toBeNull();
    expect(row.confidence).toBe('low');
  });

  it('custo aceito: parcela sem outra data vira compra datada (REVISAVEL)', () => {
    // Espelho da assimetria: 'NETFLIX 03/12 39,90' (parcela 3/12) sai datada e
    // sem projecao. Tradeoff consciente; ver o topo de text.ts.
    const row = onlyRow('NETFLIX 03/12 39,90', { defaultCompetence: '2026-09' });
    expect(row.occurredOn).toBe('2026-12-03');
    expect(row.installment).toBeNull();
    expect(row.confidence).toBe('low');
  });

  it('data com dia > mes continua sendo data, nao parcela', () => {
    // `10/09` nao fecha como parcela (10 > 9), entao e data legítima.
    const row = onlyRow('10/09 LOJA SINTETICA 50,00', { defaultCompetence: '2026-01' });
    expect(row.occurredOn).toBe('2026-09-10');
    expect(row.installment).toBeNull();
  });

  it('pontuacao final nao vira token de valor', () => {
    const result = parsePastedText('10/09/2026 LOJA SINTETICA R$ 50,00.');
    expect(result.diagnostics).toHaveLength(0);
    const row = result.rows[0];
    expect(row?.amountCents).toBe(5000);
    expect(row?.confidence).toBe('high');
    expect(row?.rawDescription).toBe('LOJA SINTETICA');
  });

  it('parenteses orfaos nao sobram na descricao', () => {
    expect(onlyRow('10/09/2026 LOJA SINTETICA (50,00)').rawDescription).toBe('LOJA SINTETICA');
  });
});

describe('parsePastedText — pureza e reentrancia', () => {
  it('nao guarda estado entre chamadas', () => {
    const first = parsePastedText('10/09/2026 LOJA A 50,00');
    const second = parsePastedText('10/09/2026 LOJA B 10,00');
    expect(first.rows[0]?.rawDescription).toBe('LOJA A');
    expect(second.rows[0]?.rawDescription).toBe('LOJA B');
  });

  it('nao lanca para entrada malformada na borda', () => {
    expect(() => parsePastedText(undefined as unknown as string)).not.toThrow();
    expect(() => parsePastedText(null as unknown as string)).not.toThrow();
    expect(parsePastedText(undefined as unknown as string).rows).toEqual([]);
  });
});
