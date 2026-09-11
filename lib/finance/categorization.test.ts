import { describe, expect, it } from 'vitest';

import {
  categorizeBatch,
  matchRule,
  suggestRulePattern,
  type Rule,
} from '@/lib/finance/categorization';
import { normalizeDescription } from '@/lib/finance/dedupe';

/** Monta uma regra com os campos que o teste nao usa ja preenchidos. */
function rule(over: Partial<Rule> & Pick<Rule, 'id' | 'pattern'>): Rule {
  return {
    matchType: 'contains',
    categoryId: `cat-${over.id}`,
    memberId: null,
    priority: 100,
    active: true,
    ...over,
  };
}

describe('matchRule', () => {
  it('casa por trecho, ignorando caixa e acento', () => {
    const regras = [rule({ id: 'r1', pattern: 'Pão de Açúcar' })];
    expect(matchRule(regras, 'PAO DE ACUCAR LOJA 12')?.id).toBe('r1');
    expect(matchRule(regras, 'pão de açúcar')?.id).toBe('r1');
  });

  it('casa a regra em todas as parcelas da mesma compra', () => {
    // O sufixo de parcela sai na normalizacao, entao a regra pega as 10.
    const regras = [rule({ id: 'r1', pattern: 'mercado livre' })];
    expect(matchRule(regras, 'MERCADO LIVRE PARC 03/10')?.id).toBe('r1');
    expect(matchRule(regras, 'MERCADO LIVRE PARC 07/10')?.id).toBe('r1');
  });

  it('devolve null quando nada casa', () => {
    const regras = [rule({ id: 'r1', pattern: 'uber' })];
    expect(matchRule(regras, 'PADARIA CENTRAL')).toBeNull();
    expect(matchRule([], 'PADARIA CENTRAL')).toBeNull();
  });

  it('respeita priority ascendente', () => {
    // As duas casam; vence a de menor priority, independente da ordem da lista.
    const regras = [
      rule({ id: 'r-alta', pattern: 'uber', priority: 50 }),
      rule({ id: 'r-baixa', pattern: 'uber', priority: 10 }),
    ];
    expect(matchRule(regras, 'UBER TRIP')?.id).toBe('r-baixa');
    expect(matchRule([...regras].reverse(), 'UBER TRIP')?.id).toBe('r-baixa');
  });

  it('desempata por id ascendente quando a priority e igual', () => {
    // Mesma priority: 'r-a' < 'r-b' em ordem de string.
    const regras = [
      rule({ id: 'r-b', pattern: 'uber', priority: 10 }),
      rule({ id: 'r-a', pattern: 'uber', priority: 10 }),
    ];
    expect(matchRule(regras, 'UBER TRIP')?.id).toBe('r-a');
    expect(matchRule([...regras].reverse(), 'UBER TRIP')?.id).toBe('r-a');
  });

  it('nao muta a lista de regras recebida', () => {
    const regras = [
      rule({ id: 'r-b', pattern: 'uber', priority: 10 }),
      rule({ id: 'r-a', pattern: 'uber', priority: 10 }),
    ];
    matchRule(regras, 'UBER TRIP');
    expect(regras.map((r) => r.id)).toEqual(['r-b', 'r-a']);
  });

  it('regra inativa nunca casa', () => {
    const regras = [
      rule({ id: 'r1', pattern: 'uber', priority: 1, active: false }),
      rule({ id: 'r2', pattern: 'uber', priority: 2 }),
    ];
    expect(matchRule(regras, 'UBER TRIP')?.id).toBe('r2');
  });

  it('matchType exact exige a descricao inteira', () => {
    const regras = [rule({ id: 'r1', pattern: 'uber', matchType: 'exact' })];
    expect(matchRule(regras, 'UBER')?.id).toBe('r1');
    expect(matchRule(regras, 'UBER TRIP')).toBeNull();
  });

  it('matchType regex casa por expressao', () => {
    const regras = [
      rule({ id: 'r1', pattern: '^uber (trip|eats)$', matchType: 'regex' }),
    ];
    expect(matchRule(regras, 'UBER TRIP')?.id).toBe('r1');
    expect(matchRule(regras, 'Uber Eats')?.id).toBe('r1');
    expect(matchRule(regras, 'UBER MOTO')).toBeNull();
  });

  it('regex INVALIDA e ignorada e NUNCA lanca', () => {
    const regras = [rule({ id: 'r1', pattern: '([', matchType: 'regex', priority: 1 })];
    expect(() => matchRule(regras, 'QUALQUER COISA')).not.toThrow();
    expect(matchRule(regras, 'QUALQUER COISA')).toBeNull();
  });

  it('regex invalida nao impede a proxima regra de casar', () => {
    // O erro de uma regra nao pode derrubar a importacao inteira.
    const regras = [
      rule({ id: 'r-quebrada', pattern: '(?<', matchType: 'regex', priority: 1 }),
      rule({ id: 'r-boa', pattern: 'padaria', priority: 2 }),
    ];
    expect(matchRule(regras, 'PADARIA CENTRAL')?.id).toBe('r-boa');
  });

  it('padrao vazio nao casa nada, em vez de casar tudo', () => {
    const regras = [rule({ id: 'r1', pattern: '' })];
    expect(matchRule(regras, 'QUALQUER COISA')).toBeNull();
    expect(matchRule([rule({ id: 'r1', pattern: '   ' })], 'QUALQUER')).toBeNull();
  });
});

describe('categorizeBatch', () => {
  it('categoriza cada linha pela regra vencedora', () => {
    const regras = [
      rule({ id: 'r-uber', pattern: 'uber', categoryId: 'transporte' }),
      rule({
        id: 'r-padaria',
        pattern: 'padaria',
        categoryId: 'alimentacao',
        memberId: 'membro-1',
      }),
    ];
    const resultado = categorizeBatch(regras, [
      { id: 'linha-1', description: 'UBER TRIP 123' },
      { id: 'linha-2', description: 'PADARIA CENTRAL' },
    ]);

    expect(resultado['linha-1']).toEqual({
      categoryId: 'transporte',
      memberId: null,
      ruleId: 'r-uber',
    });
    expect(resultado['linha-2']).toEqual({
      categoryId: 'alimentacao',
      memberId: 'membro-1',
      ruleId: 'r-padaria',
    });
  });

  it('linha sem regra fica FORA do resultado', () => {
    const regras = [rule({ id: 'r-uber', pattern: 'uber' })];
    const resultado = categorizeBatch(regras, [
      { id: 'linha-1', description: 'UBER TRIP' },
      { id: 'linha-2', description: 'FARMACIA' },
    ]);

    expect(Object.keys(resultado)).toEqual(['linha-1']);
    expect(resultado['linha-2']).toBeUndefined();
  });

  it('lote vazio e regras vazias devolvem objeto vazio', () => {
    expect(categorizeBatch([], [{ id: 'a', description: 'X' }])).toEqual({});
    expect(categorizeBatch([rule({ id: 'r1', pattern: 'x' })], [])).toEqual({});
  });

  it('aplica a mesma ordem de prioridade do matchRule em todo o lote', () => {
    const regras = [
      rule({ id: 'r-generica', pattern: 'mercado', priority: 90, categoryId: 'geral' }),
      rule({
        id: 'r-especifica',
        pattern: 'mercado livre',
        priority: 10,
        categoryId: 'compras',
      }),
    ];
    const resultado = categorizeBatch(regras, [
      { id: 'l1', description: 'MERCADO LIVRE PARC 02/06' },
      { id: 'l2', description: 'MERCADO MUNICIPAL' },
    ]);
    // A especifica (priority 10) vence na linha do Mercado Livre.
    expect(resultado['l1']?.categoryId).toBe('compras');
    // A generica pega a outra linha.
    expect(resultado['l2']?.categoryId).toBe('geral');
  });

  it('regex invalida no meio do lote nao derruba o lote', () => {
    const regras = [
      rule({ id: 'r-quebrada', pattern: '([', matchType: 'regex', priority: 1 }),
      rule({ id: 'r-boa', pattern: 'uber', priority: 2 }),
    ];
    expect(() =>
      categorizeBatch(regras, [{ id: 'l1', description: 'UBER TRIP' }]),
    ).not.toThrow();
    expect(categorizeBatch(regras, [{ id: 'l1', description: 'UBER TRIP' }])['l1']
      ?.ruleId).toBe('r-boa');
  });
});

describe('suggestRulePattern', () => {
  it('sempre devolve matchType contains', () => {
    expect(suggestRulePattern('QUALQUER COISA').matchType).toBe('contains');
  });

  it('remove o sufixo de parcela', () => {
    expect(suggestRulePattern('MERCADO LIVRE PARC 03/10').pattern).toBe(
      'mercado livre',
    );
    expect(suggestRulePattern('Mercado Livre (3/10)').pattern).toBe('mercado livre');
  });

  it('remove data do fim', () => {
    expect(suggestRulePattern('PAG*IFOOD 15/03').pattern).toBe('pag*ifood');
    expect(suggestRulePattern('UBER TRIP 2026-03-10').pattern).toBe('uber trip');
  });

  it('remove codigo de terminal do fim', () => {
    // '8kdj2xy' comeca por digito: e codigo, nao nome de loja.
    expect(suggestRulePattern('UBER *TRIP 8KDJ2XY').pattern).toBe('uber *trip');
    // '4587' nao tem letra nenhuma.
    expect(suggestRulePattern('POSTO SHELL 4587').pattern).toBe('posto shell');
  });

  it('remove digito colado no fim da palavra, preservando a palavra', () => {
    expect(suggestRulePattern('MERCADO LIVRE*3').pattern).toBe('mercado livre');
    expect(suggestRulePattern('IFOOD-2').pattern).toBe('ifood');
  });

  it('preserva digito que faz parte do nome no meio da descricao', () => {
    // Cortar o meio quebraria a contiguidade e a regra nao casaria a si mesma.
    expect(suggestRulePattern('PADARIA 2 IRMAOS').pattern).toBe('padaria 2 irmaos');
  });

  it('tira acento e caixa', () => {
    expect(suggestRulePattern('PÃO DE AÇÚCAR 1234').pattern).toBe('pao de acucar');
  });

  it('descricao so de digitos nao vira padrao vazio', () => {
    // Padrao vazio nao casaria nada; a descricao normalizada ainda serve.
    expect(suggestRulePattern('12345').pattern).toBe('12345');
  });

  it('INVARIANTE: o padrao sugerido casa a propria descricao que o gerou', () => {
    // Sugestao que nao casa a si mesma e pior do que nenhuma sugestao.
    const descricoes = [
      'MERCADO LIVRE PARC 03/10',
      'PAG*IFOOD 15/03',
      'UBER *TRIP 8KDJ2XY',
      'POSTO SHELL 4587',
      'MERCADO LIVRE*3',
      'PÃO DE AÇÚCAR 1234',
      'PADARIA 2 IRMAOS',
      'Mercado Livre (3/10)',
      '12345',
    ];

    for (const descricao of descricoes) {
      const { pattern, matchType } = suggestRulePattern(descricao);
      // E trecho contiguo da descricao normalizada...
      expect(normalizeDescription(descricao).includes(pattern)).toBe(true);
      // ...e a regra montada com ele casa a linha original.
      const regra = rule({ id: 'r-sugerida', pattern, matchType });
      expect(matchRule([regra], descricao)?.id).toBe('r-sugerida');
    }
  });

  it('INVARIANTE: o padrao tambem casa as outras parcelas da mesma compra', () => {
    // A regra nasce de uma linha e precisa valer para o plano inteiro.
    const { pattern } = suggestRulePattern('MERCADO LIVRE PARC 03/10');
    const regra = rule({ id: 'r-sugerida', pattern });
    for (let n = 1; n <= 10; n += 1) {
      const linha = `MERCADO LIVRE PARC ${String(n).padStart(2, '0')}/10`;
      expect(matchRule([regra], linha)?.id).toBe('r-sugerida');
    }
  });
});
