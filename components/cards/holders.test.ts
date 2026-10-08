import { describe, expect, it } from 'vitest';

import {
  buildHolderBody,
  deleteHolderQuestion,
  holderConfirmation,
  holderRows,
  holderSubmitHint,
  HOLDERS_NOTE,
  normalizeLast4,
  type HolderRecord,
} from './holders';

const MEMBERS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Ricardo' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Ana' },
];
const holder = (id: string, last4: string, memberId: string): HolderRecord => ({ id, last4, memberId });

describe('final do cartão: só os 4 últimos dígitos', () => {
  it('aceita 4 dígitos, com máscara, espaços ou asteriscos ao redor', () => {
    expect(normalizeLast4('1234')).toBe('1234');
    expect(normalizeLast4(' 1234 ')).toBe('1234');
    expect(normalizeLast4('•••• 1234')).toBe('1234');
    expect(normalizeLast4('**** 0042')).toBe('0042');
    expect(normalizeLast4('12 34')).toBe('1234');
  });

  it('recusa o que não for exatamente 4 dígitos, inclusive número de cartão inteiro (não se guarda)', () => {
    for (const bad of ['', '123', '12345', 'abcd', '12a4', '4111 1111 1111 1111', '-123']) {
      expect(normalizeLast4(bad), bad).toBeNull();
    }
  });

  it('zeros à esquerda se preservam (é texto, não número)', () => {
    expect(normalizeLast4('0007')).toBe('0007');
  });
});

describe('formulário Adicionar final', () => {
  it('monta o corpo com o final normalizado e o membro escolhido', () => {
    expect(buildHolderBody({ last4: '•••• 1234', memberId: MEMBERS[0]!.id }, MEMBERS)).toEqual({
      ok: true,
      body: { last4: '1234', memberId: MEMBERS[0]!.id },
    });
  });

  it('erra no campo certo: final inválido, membro vazio ou que não é da casa', () => {
    const result = buildHolderBody({ last4: '12', memberId: '' }, MEMBERS);
    expect(result).toEqual({
      ok: false,
      errors: {
        last4: 'Informe os 4 últimos dígitos do cartão (só números).',
        memberId: 'Escolha o responsável.',
      },
    });
    const stranger = buildHolderBody({ last4: '1234', memberId: '99999999-9999-4999-8999-999999999999' }, MEMBERS);
    expect(stranger).toEqual({ ok: false, errors: { memberId: 'Escolha o responsável.' } });
  });
});

describe('lista de finais', () => {
  const holders = [
    holder('h3', '9999', MEMBERS[1]!.id),
    holder('h1', '0042', MEMBERS[0]!.id),
    holder('h2', '1234', '99999999-9999-4999-8999-999999999999'),
  ];

  it('ordena por final e mostra o nome do responsável; membro que sumiu aparece como "—", sem quebrar', () => {
    expect(holderRows(holders, MEMBERS)).toEqual([
      { id: 'h1', last4: '0042', display: '•••• 0042', memberName: 'Ricardo' },
      { id: 'h2', last4: '1234', display: '•••• 1234', memberName: null },
      { id: 'h3', last4: '9999', display: '•••• 9999', memberName: 'Ana' },
    ]);
  });

  it('lista vazia: nada, e não altera a entrada', () => {
    expect(holderRows([], MEMBERS)).toEqual([]);
    const copy = [...holders];
    holderRows(holders, MEMBERS);
    expect(holders).toEqual(copy);
  });

  it('avisa que salvar um final já mapeado TROCA o responsável (upsert), com o nome atual', () => {
    expect(holderSubmitHint(holders, '•••• 0042', MEMBERS)).toBe(
      'O final 0042 já está mapeado para Ricardo: salvar troca o responsável.',
    );
    expect(holderSubmitHint(holders, '1234', MEMBERS)).toBe('O final 1234 já está mapeado: salvar troca o responsável.');
    expect(holderSubmitHint(holders, '5555', MEMBERS)).toBeNull();
    expect(holderSubmitHint(holders, 'abc', MEMBERS)).toBeNull();
  });
});

describe('textos', () => {
  it('a nota diz que só o Mercado Pago imprime o final na fatura hoje, e que é opcional', () => {
    expect(HOLDERS_NOTE).toContain('Mercado Pago');
    expect(HOLDERS_NOTE).toMatch(/só o Mercado Pago/);
    expect(HOLDERS_NOTE).toMatch(/opcional/i);
  });

  it('confirmações curtas', () => {
    expect(holderConfirmation('created')).toBe('Final adicionado.');
    expect(holderConfirmation('replaced')).toBe('O final já estava mapeado: o responsável foi trocado.');
    expect(holderConfirmation('deleted')).toBe('Final removido.');
  });

  it('pergunta antes de apagar, com o final e o responsável', () => {
    expect(deleteHolderQuestion({ id: 'h1', last4: '0042', display: '•••• 0042', memberName: 'Ricardo' })).toBe(
      'Remover o final 0042 (Ricardo)?',
    );
    expect(deleteHolderQuestion({ id: 'h2', last4: '1234', display: '•••• 1234', memberName: null })).toBe(
      'Remover o final 1234?',
    );
  });
});
