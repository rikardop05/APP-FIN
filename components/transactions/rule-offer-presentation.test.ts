import { describe, expect, it } from 'vitest';
import { ruleOfferAcceptedMessage, ruleOfferDescription, shouldOfferAfterEdit } from './rule-offer-presentation';

const CAT = '00000000-0000-4000-8000-000000000001';
const RULE = '00000000-0000-4000-8000-000000000002';
const T1 = '00000000-0000-4000-8000-000000000003';
const T2 = '00000000-0000-4000-8000-000000000004';

describe('shouldOfferAfterEdit', () => {
  it('pergunta quando a categoria mudou para uma categoria', () => {
    expect(shouldOfferAfterEdit(null, CAT)).toBe(true);
    expect(shouldOfferAfterEdit(RULE, CAT)).toBe(true);
  });

  it('nao pergunta ao manter a categoria, tirar a categoria ou editar sem categoria', () => {
    expect(shouldOfferAfterEdit(CAT, CAT)).toBe(false);
    expect(shouldOfferAfterEdit(CAT, null)).toBe(false);
    expect(shouldOfferAfterEdit(null, null)).toBe(false);
  });
});

describe('ruleOfferDescription', () => {
  it('sem outras linhas: so o efeito nas proximas importacoes', () => {
    expect(ruleOfferDescription({ pattern: 'irmaos boa', categoryId: CAT, categoryName: 'Mercado', matchingIds: [] })).toBe(
      'Os próximos lançamentos com “irmaos boa” na descrição vão para Mercado sozinhos.',
    );
  });

  it('com outras linhas sem categoria, singular e plural', () => {
    expect(ruleOfferDescription({ pattern: 'kabum', categoryId: CAT, categoryName: 'Casa', matchingIds: [T1] })).toBe(
      'Os próximos lançamentos com “kabum” na descrição vão para Casa sozinhos. Agora, também 1 lançamento sem categoria vai para Casa.',
    );
    expect(ruleOfferDescription({ pattern: 'kabum', categoryId: CAT, categoryName: 'Casa', matchingIds: [T1, T2] })).toBe(
      'Os próximos lançamentos com “kabum” na descrição vão para Casa sozinhos. Agora, também 2 lançamentos sem categoria vão para Casa.',
    );
  });
});

describe('ruleOfferAcceptedMessage', () => {
  it('so a regra', () => {
    expect(ruleOfferAcceptedMessage({ ruleId: RULE, applied: 0, skipped: 0, propagated: 0 })).toBe('Regra criada.');
  });

  it('com aplicados, propagacao e pulados', () => {
    expect(ruleOfferAcceptedMessage({ ruleId: RULE, applied: 2, skipped: 1, propagated: 3 })).toBe(
      'Regra criada; 2 lançamentos categorizados por ela; 3 parcelas sem categoria acompanharam o parcelamento; 1 pulado porque mudou desde a oferta.',
    );
  });
});
