import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { dedupeHash, normalizeDescription } from '@/lib/finance/dedupe';
import { cents } from '@/lib/money';

/** Lancamento de referencia, reusado para variar um campo por vez. */
const BASE = {
  sourceId: 'cartao-1',
  occurredOn: '2026-03-10',
  amountCents: cents(-4990),
  rawDescription: 'Mercado Livre',
};

describe('normalizeDescription', () => {
  it('baixa a caixa, tira acento e colapsa espaco', () => {
    expect(normalizeDescription('PÃO DE AÇÚCAR')).toBe('pao de acucar');
    expect(normalizeDescription('Mercado   Livre')).toBe('mercado livre');
    expect(normalizeDescription('  Padaria Central  ')).toBe('padaria central');
  });

  it('remove o sufixo de parcela em todas as formas', () => {
    expect(normalizeDescription('MERCADO LIVRE PARC 03/10')).toBe('mercado livre');
    expect(normalizeDescription('Mercado Livre (3/10)')).toBe('mercado livre');
    expect(normalizeDescription('Mercado Livre (3 de 10)')).toBe('mercado livre');
    expect(normalizeDescription('Mercado Livre PARCELA 3 DE 10')).toBe('mercado livre');
    expect(normalizeDescription('Mercado Livre parc. 3/10')).toBe('mercado livre');
    expect(normalizeDescription('Mercado Livre 3/10')).toBe('mercado livre');
    expect(normalizeDescription('Mercado Livre - 3/10')).toBe('mercado livre');
  });

  it('as 10 parcelas de uma compra colapsam na mesma descricao', () => {
    // E o que permite agrupar o plano inteiro sob um nome so.
    const todas = Array.from({ length: 10 }, (_, i) =>
      normalizeDescription(`MERCADO LIVRE PARC ${String(i + 1).padStart(2, '0')}/10`),
    );
    expect(new Set(todas).size).toBe(1);
    expect(todas[0]).toBe('mercado livre');
  });

  it('nao confunde par de numeros que nao e parcela', () => {
    // 0 nao e numero de parcela, 1 nao e total de parcelas, e 7/3 nao existe.
    expect(normalizeDescription('Posto 0/5')).toBe('posto 0/5');
    expect(normalizeDescription('Posto 1/1')).toBe('posto 1/1');
    expect(normalizeDescription('Posto 7/3')).toBe('posto 7/3');
  });

  it('sufixo sem descricao antes nao e removido', () => {
    // Sobraria string vazia, que nao identifica lancamento nenhum.
    expect(normalizeDescription('3/10')).toBe('3/10');
  });

  it('descricao vazia continua vazia', () => {
    expect(normalizeDescription('')).toBe('');
    expect(normalizeDescription('   ')).toBe('');
  });
});

describe('dedupeHash', () => {
  it('usa sha256 de verdade', () => {
    // Ancora publica: sha256 da string vazia e uma constante conhecida.
    // Se node:crypto devolvesse outro algoritmo, este teste cairia.
    expect(createHash('sha256').update('', 'utf8').digest('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hasheia exatamente a string canonica montada a mao', () => {
    // A string canonica e: sourceId, data, centavos e descricao normalizada,
    // separados por NUL. Para este lancamento, montada a mao:
    //   'cartao-1' + NUL + '2026-03-10' + NUL + '-4990' + NUL + 'mercado livre'
    // O digest nao da para conferir a mao, mas a MONTAGEM da — que e a parte
    // com logica. O sha256 e primitivo, ancorado no teste acima.
    const canonica = ['cartao-1', '2026-03-10', '-4990', 'mercado livre'].join('\u0000');
    const esperado = createHash('sha256').update(canonica, 'utf8').digest('hex');
    expect(dedupeHash(BASE)).toBe(esperado);
  });

  it('devolve 64 caracteres hex minusculos', () => {
    expect(dedupeHash(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('acento, caixa e espaco duplo NAO alteram o hash', () => {
    const referencia = dedupeHash({ ...BASE, rawDescription: 'Pao de Acucar' });
    expect(dedupeHash({ ...BASE, rawDescription: 'PÃO DE AÇÚCAR' })).toBe(referencia);
    expect(dedupeHash({ ...BASE, rawDescription: 'pão   de açúcar' })).toBe(referencia);
    expect(dedupeHash({ ...BASE, rawDescription: '  Pão de Açúcar  ' })).toBe(
      referencia,
    );
  });

  it('sufixo de parcela DIFERENTE gera hash DIFERENTE', () => {
    // 3/10 e 4/10 sao dois lancamentos distintos da mesma compra parcelada.
    const terceira = dedupeHash({ ...BASE, rawDescription: 'MERCADO LIVRE PARC 03/10' });
    const quarta = dedupeHash({ ...BASE, rawDescription: 'MERCADO LIVRE PARC 04/10' });
    expect(terceira).not.toBe(quarta);
  });

  it('a mesma parcela escrita de formas diferentes gera o MESMO hash', () => {
    // O marcador volta em forma canonica, entao PDF e texto colado convergem.
    const comParc = dedupeHash({ ...BASE, rawDescription: 'MERCADO LIVRE PARC 03/10' });
    const comParenteses = dedupeHash({
      ...BASE,
      rawDescription: 'Mercado Livre (3/10)',
    });
    const comDe = dedupeHash({ ...BASE, rawDescription: 'Mercado Livre 3 de 10' });
    expect(comParenteses).toBe(comParc);
    expect(comDe).toBe(comParc);
  });

  it('descricao com parcela difere de descricao sem parcela', () => {
    const semParcela = dedupeHash({ ...BASE, rawDescription: 'Mercado Livre' });
    const comParcela = dedupeHash({ ...BASE, rawDescription: 'Mercado Livre 3/10' });
    expect(semParcela).not.toBe(comParcela);
  });

  it('duas compras distintas com os mesmos quatro campos COLIDEM — comportamento esperado', () => {
    // Dois cafes no mesmo dia, mesmo cartao, mesmo valor: nao ha nada no
    // lancamento que os separe. A colisao e deliberada, e criterio de aceite
    // do T-103; quem decide se e duplicata ou segunda compra e a tela de
    // confirmacao.
    //
    // Dois literais INDEPENDENTES de proposito. Espalhar o mesmo objeto
    // (`{ ...BASE }`) so provaria que a funcao e deterministica: passaria ate
    // numa implementacao que ignorasse os quatro campos.
    const primeiroCafe = {
      sourceId: 'cartao-1',
      occurredOn: '2026-03-10',
      amountCents: cents(-850),
      rawDescription: 'CAFETERIA CENTRAL',
    };
    const segundoCafe = {
      sourceId: 'cartao-1',
      occurredOn: '2026-03-10',
      amountCents: cents(-850),
      rawDescription: 'CAFETERIA CENTRAL',
    };
    expect(dedupeHash(primeiroCafe)).toBe(dedupeHash(segundoCafe));
  });

  it('a mesma compra vinda do PDF e do texto colado converge no mesmo hash', () => {
    // Propriedade DIFERENTE da de cima: aqui a grafia muda (caixa e espaco) e
    // o hash tem de convergir mesmo assim, senao a mesma linha importada por
    // dois caminhos entraria duas vezes.
    const doPdf = dedupeHash({
      sourceId: 'cartao-1',
      occurredOn: '2026-03-10',
      amountCents: cents(-850),
      rawDescription: 'CAFETERIA  DO  LARGO',
    });
    const doTextoColado = dedupeHash({
      sourceId: 'cartao-1',
      occurredOn: '2026-03-10',
      amountCents: cents(-850),
      rawDescription: 'Cafeteria do Largo',
    });
    expect(doTextoColado).toBe(doPdf);
  });

  it('cada campo entra no hash: mudar um so ja separa', () => {
    const referencia = dedupeHash(BASE);
    expect(dedupeHash({ ...BASE, sourceId: 'cartao-2' })).not.toBe(referencia);
    expect(dedupeHash({ ...BASE, occurredOn: '2026-03-11' })).not.toBe(referencia);
    expect(dedupeHash({ ...BASE, amountCents: cents(-4991) })).not.toBe(referencia);
    expect(dedupeHash({ ...BASE, rawDescription: 'Outra Loja' })).not.toBe(referencia);
  });

  it('valor de sinal trocado nao colide com o original', () => {
    // -4990 (gasto) e 4990 (estorno) sao lancamentos diferentes.
    expect(dedupeHash({ ...BASE, amountCents: cents(4990) })).not.toBe(
      dedupeHash(BASE),
    );
  });

  it('o separador impede colisao por deslocamento de fronteira de campo', () => {
    // Este par so prova alguma coisa porque colide DE VERDADE sem separador:
    //   -4990 + 'x'   -> 'cartao-1' '2026-03-10' '-4990' 'x'
    //   -499  + '0x'  -> 'cartao-1' '2026-03-10' '-499'  '0x'
    // concatenados sem nada no meio, os dois dao 'cartao-12026-03-10-4990x'.
    // Com NUL entre os campos, a fronteira nao desliza e os hashes diferem.
    // (O teste anterior aqui variava o sourceId, e por isso passaria mesmo com
    // o separador removido — nao provava o separador.)
    const a = dedupeHash({ ...BASE, amountCents: cents(-4990), rawDescription: 'x' });
    const b = dedupeHash({ ...BASE, amountCents: cents(-499), rawDescription: '0x' });
    expect(a).not.toBe(b);
  });

  it('recusa data que nao existe no calendario', () => {
    // Senao a mesma compra entraria duas vezes com a data escrita de dois
    // jeitos, cada uma com seu hash.
    expect(() => dedupeHash({ ...BASE, occurredOn: '2026-02-30' })).toThrow(RangeError);
    expect(() => dedupeHash({ ...BASE, occurredOn: '2026-3-10' })).toThrow(RangeError);
  });

  it('recusa valor que nao e inteiro de centavos', () => {
    expect(() =>
      // Valor fracionario so chega aqui se alguem burlou o tipo na borda.
      dedupeHash({ ...BASE, amountCents: 10.5 as unknown as typeof BASE.amountCents }),
    ).toThrow(RangeError);
  });
});
