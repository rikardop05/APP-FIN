import { describe, expect, it } from 'vitest';

import {
  categorizeBatch,
  groupUncategorized,
  matchRule,
  previewRule,
  suggestRulePattern,
  type CategorizationRow,
  type Rule,
} from '@/lib/finance/categorization';
import { normalizeDescription } from '@/lib/finance/dedupe';
import { cents } from '@/lib/money';

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

  it('corta o prefixo de cartao "[final NNNN]" do inicio', () => {
    // A mesma loja aparece com e sem o prefixo, conforme o cartao/fatura.
    // Com o prefixo no padrao, a regra nao casaria a versao sem ele.
    expect(suggestRulePattern('[final 4239] IRMAOS BOA').pattern).toBe('irmaos boa');
    expect(suggestRulePattern('[FINAL 2387] IG*ExitLag (11/12)').pattern).toBe('ig*exitlag');
  });

  it('a regra sugerida com prefixo casa a mesma loja sem prefixo', () => {
    const { pattern } = suggestRulePattern('[final 4239] IRMAOS BOA');
    const regra = rule({ id: 'r-sugerida', pattern });
    expect(matchRule([regra], 'IRMAOS BOA')?.id).toBe('r-sugerida');
  });

  it('corta o sufixo "- NuPay" do fim', () => {
    expect(suggestRulePattern('KaBuM! - NuPay').pattern).toBe('kabum');
    expect(suggestRulePattern('Pichau Informatica - NuPay (6/7)').pattern).toBe(
      'pichau informatica',
    );
    expect(suggestRulePattern('Pichau Informatica - NuPay - Parcela 5/7').pattern).toBe(
      'pichau informatica',
    );
  });

  it('prefixo de cartao, parcela e codigo final juntos', () => {
    expect(suggestRulePattern('[final 4239] NFS PREMIUM ITUPEVA (3/4)').pattern).toBe(
      'nfs premium itupeva',
    );
    expect(suggestRulePattern('[final 4239] DROGASIL3359').pattern).toBe('drogasil');
    expect(suggestRulePattern('FORT ATACADISTA 635').pattern).toBe('fort atacadista');
  });

  it('descricao que e so o prefixo de cartao nao vira padrao vazio', () => {
    expect(suggestRulePattern('[final 4239]').pattern).toBe('[final 4239]');
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
      '[final 4239] IRMAOS BOA',
      'KaBuM! - NuPay',
      'Pichau Informatica - NuPay - Parcela 5/7',
      '[final 4239] NFS PREMIUM ITUPEVA (3/4)',
      '[final 4239]',
      '- NuPay',
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

/** Linha candidata a revisao; por padrao, despesa sem categoria. */
function row(
  over: Partial<CategorizationRow> & Pick<CategorizationRow, 'id' | 'description'>,
): CategorizationRow {
  return {
    amountCents: cents(-1000),
    kind: 'expense',
    categoryId: null,
    ...over,
  };
}

describe('groupUncategorized', () => {
  it('lista vazia devolve lista vazia', () => {
    expect(groupUncategorized([], [])).toEqual([]);
  });

  it('agrupa pela loja: prefixo de cartao, parcela e "- NuPay" caem no mesmo grupo', () => {
    const grupos = groupUncategorized(
      [
        row({ id: 't1', description: '[final 4239] IRMAOS BOA', amountCents: cents(-10000) }),
        row({ id: 't2', description: 'IRMAOS BOA', amountCents: cents(-2550) }),
        row({ id: 't3', description: 'KaBuM! - NuPay (9/10)', amountCents: cents(-4365) }),
        row({ id: 't4', description: 'KaBuM! - NuPay', amountCents: cents(-4366) }),
      ],
      [],
    );

    expect(grupos).toEqual([
      // -10000 + -2550 = -12550
      { pattern: 'irmaos boa', ids: ['t1', 't2'], totalCents: -12550, ruleId: null, suggestedCategoryId: null },
      // -4365 + -4366 = -8731
      { pattern: 'kabum', ids: ['t3', 't4'], totalCents: -8731, ruleId: null, suggestedCategoryId: null },
    ]);
  });

  it('ordena pelo tamanho do total (valor absoluto), maior primeiro', () => {
    const grupos = groupUncategorized(
      [
        row({ id: 'p', description: 'PADARIA', amountCents: cents(-900) }),
        // Receita sem categoria tambem e revisada; +5.000,00 e o maior impacto.
        row({ id: 's', description: 'SALARIO ACME', amountCents: cents(500000), kind: 'income' }),
        row({ id: 'f', description: 'FORT ATACADISTA 635', amountCents: cents(-76294) }),
      ],
      [],
    );
    // |500000| > |-76294| > |-900|
    expect(grupos.map((grupo) => grupo.pattern)).toEqual([
      'salario acme',
      'fort atacadista',
      'padaria',
    ]);
  });

  it('desempata total de mesmo tamanho pelo padrao, em ordem alfabetica', () => {
    const grupos = groupUncategorized(
      [
        row({ id: 'b', description: 'B LOJA', amountCents: cents(-500) }),
        row({ id: 'a', description: 'A LOJA', amountCents: cents(500), kind: 'income' }),
      ],
      [],
    );
    expect(grupos.map((grupo) => grupo.pattern)).toEqual(['a loja', 'b loja']);
  });

  it('exclui pagamento de fatura, linha de valor zero e linha ja categorizada', () => {
    const grupos = groupUncategorized(
      [
        row({ id: 'pg', description: 'PAGAMENTO RECEBIDO', amountCents: cents(100000), kind: 'credit_card_payment' }),
        row({ id: 'an', description: 'ANUIDADE DIFERENCIADA', amountCents: cents(0), kind: 'income' }),
        row({ id: 'ok', description: 'IRMAOS BOA', categoryId: 'cat-mercado' }),
        row({ id: 'ib', description: 'IRMAOS BOA', amountCents: cents(-2550) }),
      ],
      [],
    );
    expect(grupos).toEqual([
      { pattern: 'irmaos boa', ids: ['ib'], totalCents: -2550, ruleId: null, suggestedCategoryId: null },
    ]);
  });

  it('linha que uma regra ativa ja casa vem no grupo da regra, com a categoria sugerida', () => {
    // Regra criada depois da importacao: as linhas antigas continuam sem
    // categoria, e o grupo ja chega preenchido para o usuario so confirmar.
    const regras = [rule({ id: 'r1', pattern: 'kabum', categoryId: 'cat-eletronicos' })];
    const grupos = groupUncategorized(
      [
        row({ id: 't3', description: 'KaBuM! - NuPay (9/10)', amountCents: cents(-4365) }),
        row({ id: 't4', description: 'KABUM ONLINE', amountCents: cents(-1000) }),
        row({ id: 'x', description: 'OUTRA LOJA', amountCents: cents(-100) }),
      ],
      regras,
    );
    expect(grupos).toEqual([
      // -4365 + -1000 = -5365: as duas casam 'kabum', mesmo com padroes sugeridos diferentes.
      { pattern: 'kabum', ids: ['t3', 't4'], totalCents: -5365, ruleId: 'r1', suggestedCategoryId: 'cat-eletronicos' },
      { pattern: 'outra loja', ids: ['x'], totalCents: -100, ruleId: null, suggestedCategoryId: null },
    ]);
  });

  it('grupo de regra e grupo de padrao com o mesmo texto ficam separados', () => {
    // Regra exact casa so a forma exata; a variante cai no grupo de padrao.
    const regras = [rule({ id: 'r1', pattern: 'irmaos boa', matchType: 'exact' })];
    const grupos = groupUncategorized(
      [
        row({ id: 'a', description: 'IRMAOS BOA', amountCents: cents(-300) }),
        row({ id: 'b', description: '[final 4239] IRMAOS BOA', amountCents: cents(-200) }),
      ],
      regras,
    );
    expect(grupos).toEqual([
      { pattern: 'irmaos boa', ids: ['a'], totalCents: -300, ruleId: 'r1', suggestedCategoryId: 'cat-r1' },
      { pattern: 'irmaos boa', ids: ['b'], totalCents: -200, ruleId: null, suggestedCategoryId: null },
    ]);
  });

  it('regra inativa nao agrupa nem sugere categoria', () => {
    const regras = [rule({ id: 'r1', pattern: 'irmaos', active: false })];
    const [grupo] = groupUncategorized([row({ id: 'a', description: 'IRMAOS BOA' })], regras);
    expect(grupo?.ruleId).toBeNull();
    expect(grupo?.suggestedCategoryId).toBeNull();
  });

  it('respeita a prioridade das regras ao escolher o grupo', () => {
    const regras = [
      rule({ id: 'r-geral', pattern: 'posto', priority: 20 }),
      rule({ id: 'r-shell', pattern: 'posto shell', priority: 10 }),
    ];
    const [grupo] = groupUncategorized([row({ id: 'a', description: 'POSTO SHELL 4587' })], regras);
    expect(grupo?.ruleId).toBe('r-shell');
  });

  it('nao muta as linhas nem as regras recebidas', () => {
    const linhas = [row({ id: 'b', description: 'B' }), row({ id: 'a', description: 'A' })];
    const regras = [rule({ id: 'r2', pattern: 'b', priority: 2 }), rule({ id: 'r1', pattern: 'a', priority: 1 })];
    const copiaLinhas = structuredClone(linhas);
    const copiaRegras = structuredClone(regras);
    groupUncategorized(linhas, regras);
    expect(linhas).toEqual(copiaLinhas);
    expect(regras).toEqual(copiaRegras);
  });
});

describe('previewRule', () => {
  const linhas = [
    row({ id: 't1', description: '[final 4239] IRMAOS BOA' }),
    row({ id: 't2', description: 'IRMAOS BOA (2/3)' }),
    row({ id: 'cat', description: 'IRMAOS BOA', categoryId: 'cat-mercado' }),
    row({ id: 'pg', description: 'IRMAOS BOA', kind: 'credit_card_payment' }),
    row({ id: 'zero', description: 'IRMAOS BOA', amountCents: cents(0) }),
    row({ id: 'out', description: 'OUTRA LOJA' }),
  ];

  it('devolve so as linhas sem categoria que a regra casaria, na ordem recebida', () => {
    const regra = rule({ id: 'nova', pattern: 'irmaos boa' });
    expect(previewRule(regra, linhas)).toEqual(['t1', 't2']);
  });

  it('nunca inclui linha ja categorizada: regra nao sobrescreve categoria posta a mao', () => {
    const regra = rule({ id: 'nova', pattern: 'irmaos boa' });
    expect(previewRule(regra, linhas)).not.toContain('cat');
  });

  it('nao inclui pagamento de fatura nem linha de valor zero', () => {
    const regra = rule({ id: 'nova', pattern: 'irmaos boa' });
    const ids = previewRule(regra, linhas);
    expect(ids).not.toContain('pg');
    expect(ids).not.toContain('zero');
  });

  it('regra que nao casa nada devolve lista vazia', () => {
    expect(previewRule(rule({ id: 'nova', pattern: 'inexistente' }), linhas)).toEqual([]);
  });

  it('regra inativa, padrao vazio e regex invalida devolvem lista vazia sem lancar', () => {
    expect(previewRule(rule({ id: 'n', pattern: 'irmaos', active: false }), linhas)).toEqual([]);
    expect(previewRule(rule({ id: 'n', pattern: '   ' }), linhas)).toEqual([]);
    expect(previewRule(rule({ id: 'n', pattern: '([', matchType: 'regex' }), linhas)).toEqual([]);
  });

  it('respeita o matchType: exact so casa a descricao inteira', () => {
    const regra = rule({ id: 'n', pattern: 'irmaos boa', matchType: 'exact' });
    // t2 normaliza para 'irmaos boa' (parcela removida); t1 tem o prefixo.
    expect(previewRule(regra, linhas)).toEqual(['t2']);
  });
});
