import { describe, expect, it } from 'vitest';

import { matchCardForBank, queueLabel } from './pdf-queue';

const nu = { id: '1', name: 'Nubank Ultravioleta', bank: 'Nubank' };
const nu2 = { id: '2', name: 'Roxinho', bank: 'nubank' };
const sant = { id: '3', name: 'Santander Free', bank: null };
const itau = { id: '4', name: 'Cartão da casa', bank: 'Itaú' };

describe('fila de PDFs', () => {
  it('rotula "Fatura 2 de 3" só quando há mais de um arquivo', () => {
    expect(queueLabel(2, 3)).toBe('Fatura 2 de 3');
    expect(queueLabel(1, 1)).toBeNull();
  });

  it('pré-seleciona o cartão só quando exatamente um casa com o banco', () => {
    expect(matchCardForBank('nubank_card', [nu, sant, itau])).toBe(nu);
    expect(matchCardForBank('santander_card', [nu, sant])).toBe(sant); // casa pelo nome
    expect(matchCardForBank('itau_card', [nu, itau])).toBe(itau); // sem acento no token, com acento no cadastro
  });

  it('dois cartões do mesmo banco, nenhum ou banco desconhecido: pede a origem', () => {
    expect(matchCardForBank('nubank_card', [nu, nu2])).toBeNull();
    expect(matchCardForBank('itau_card', [nu, sant])).toBeNull();
    expect(matchCardForBank(null, [nu])).toBeNull();
    expect(matchCardForBank('banco_x', [nu])).toBeNull();
  });
});
