import { describe, expect, it } from 'vitest';

import { detectInstallment } from '@/lib/import/installments';

describe('detectInstallment — os quatro padroes do aceite', () => {
  it('reconhece PARC 03/10', () => {
    expect(detectInstallment('PARC 03/10')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: '',
    });
    expect(detectInstallment('PARC 03/10 SUPERMERCADO BOM PRECO')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'SUPERMERCADO BOM PRECO',
    });
    expect(detectInstallment('MAGAZINE LUIZA PARC. 2/6')).toEqual({
      current: 2,
      total: 6,
      cleanDescription: 'MAGAZINE LUIZA',
    });
  });

  it('reconhece 03/10 solto', () => {
    expect(detectInstallment('03/10')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: '',
    });
    expect(detectInstallment('IFOOD *IFOOD 03/10')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'IFOOD *IFOOD',
    });
  });

  it('reconhece PARCELA 3 DE 10', () => {
    expect(detectInstallment('PARCELA 3 DE 10')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: '',
    });
    expect(detectInstallment('CASAS BAHIA PARCELA 3 DE 10')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'CASAS BAHIA',
    });
  });

  it('reconhece (3 de 10) e tira os parenteses junto', () => {
    expect(detectInstallment('(3 de 10)')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: '',
    });
    // O parentese so envolve o marcador: sobrar 'AMAZON () PRIME' seria pior
    // que nao ter detectado.
    expect(detectInstallment('AMAZON (3 de 10) PRIME')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'AMAZON PRIME',
    });
    expect(detectInstallment('AMAZON [3/10]')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'AMAZON',
    });
  });
});

describe('detectInstallment — descricao limpa', () => {
  it('tira o separador que sobra na ponta', () => {
    expect(detectInstallment('NETFLIX.COM - Parcela 3/12')?.cleanDescription).toBe(
      'NETFLIX.COM',
    );
    expect(detectInstallment('DROGARIA SP • 2/4')?.cleanDescription).toBe(
      'DROGARIA SP',
    );
  });

  it('costura o que sobra dos dois lados quando o marcador esta no meio', () => {
    expect(detectInstallment('COMPRA PARC 2/8 NA LOJA')?.cleanDescription).toBe(
      'COMPRA NA LOJA',
    );
  });

  it('preserva caixa e acento — normalizar e trabalho do T-104, nao daqui', () => {
    expect(detectInstallment('Padaria Açúcar - Parcela 2/6')).toEqual({
      current: 2,
      total: 6,
      cleanDescription: 'Padaria Açúcar',
    });
  });

  it('aceita variantes de escrita da palavra-chave', () => {
    expect(detectInstallment('LOJA PARCELA DE 3/10')?.current).toBe(3);
    expect(detectInstallment('LOJA PARCELAS 3/10')?.current).toBe(3);
    expect(detectInstallment('LOJA parcela nº 3/10')?.current).toBe(3);
  });
});

/**
 * O caso de borda que da nome a tarefa. `03/10` e ambiguo: parcela 3 de 10 ou
 * 3 de outubro. Os dois lados abaixo sao o criterio descrito no topo de
 * `installments.ts` — arriscar o lado errado projeta parcela fantasma por dez
 * meses.
 */
describe('detectInstallment — parcela x data', () => {
  it('data completa nunca vira parcela (filtro 2)', () => {
    expect(detectInstallment('UBER *TRIP 03/10/2026')).toBeNull();
    expect(detectInstallment('UBER *TRIP 03/10/26')).toBeNull();
    expect(detectInstallment('LANCAMENTO 2026/03/10')).toBeNull();
    expect(detectInstallment('LANCAMENTO 2026-10-03')).toBeNull();
    expect(detectInstallment('LANCAMENTO 03.10.2026')).toBeNull();
  });

  it('dia maior que o mes nao fecha como parcela (filtro 3)', () => {
    // 25/12, 31/01 e 10/03 sao datas: como parcela seriam 'parcela 25 de 12',
    // que nao existe.
    expect(detectInstallment('CEIA DE NATAL 25/12')).toBeNull();
    expect(detectInstallment('ACADEMIA 31/01')).toBeNull();
    expect(detectInstallment('PIX ENVIADO 10/03')).toBeNull();
  });

  it('preposicao de data derruba o palpite (filtro 4)', () => {
    expect(detectInstallment('ASSINATURA EM 03/10')).toBeNull();
    expect(detectInstallment('MENSALIDADE DIA 03/10')).toBeNull();
    expect(detectInstallment('SEGURO VENC 03/10')).toBeNull();
    expect(detectInstallment('CONSORCIO DESDE 01/12')).toBeNull();
  });

  it('teto de plano: par solto acima de 24 e outro numero, nao parcela', () => {
    // 2/60 projetaria cinco anos de despesa inexistente no fluxo de caixa. A
    // faixa M > 12 nao e alcancada por nenhum outro filtro: nenhum mes passa de
    // 12, e N <= M e trivial quando M e grande.
    expect(detectInstallment('COMPRA 2/60')).toBeNull();
    expect(detectInstallment('FILTRO DE OLEO 2/99')).toBeNull();
  });

  it('a fronteira do teto sem evidencia: 24 passa, 25 nao', () => {
    // Decisao de dominio do humano (CONTRACTS §15, ORCHESTRATION §5): sem a
    // palavra escrita, a candidata e ambigua por definicao, e o teto
    // conservador vale mais que a cobertura.
    expect(detectInstallment('LOJA DO CENTRO 2/24')).toEqual({
      current: 2,
      total: 24,
      cleanDescription: 'LOJA DO CENTRO',
    });
    expect(detectInstallment('LOJA DO CENTRO 2/25')).toBeNull();
  });

  it('com evidencia direta o teto sobe: quem escreveu PARCELA disse que e parcela', () => {
    expect(detectInstallment('COMPRA PARCELA 2 DE 60')).toEqual({
      current: 2,
      total: 60,
      cleanDescription: 'COMPRA',
    });
    expect(detectInstallment('MOVEIS PARC 2/60')).toEqual({
      current: 2,
      total: 60,
      cleanDescription: 'MOVEIS',
    });
    // Nem assim passa de dois digitos — limite que MAX_TOTAL nomeia e que a
    // propria expressao ja impoe.
    expect(detectInstallment('COMPRA PARCELA 2 DE 120')).toBeNull();
  });

  it('a forma por extenso tambem e evidencia direta, e vence a preposicao', () => {
    // '3 de 10' nao e data em pt-BR: a data por extenso nomeia o mes
    // ('3 de outubro'). O filtro 1 vale para a forma escrita, nao so para a
    // palavra-chave.
    expect(detectInstallment('ASSINATURA EM 3 de 10')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'ASSINATURA EM',
    });
    // E vence o desempate contra uma candidata solta.
    expect(detectInstallment('PIZZA 1/2 GRANDE (3 de 10)')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'PIZZA 1/2 GRANDE',
    });
  });

  it('os dois cenarios do F-02, como o Vigia os executou', () => {
    expect(detectInstallment('SEGURO VENC 3 de 10')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'SEGURO VENC',
    });
    expect(detectInstallment('AMAZON (3 de 10) E PIZZA 1/2')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'AMAZON E PIZZA 1/2',
    });
  });

  it('a palavra-chave vence a preposicao (filtro 1 acima do 4)', () => {
    // 'PARCELA' e evidencia direta; a preposicao e so contexto.
    expect(detectInstallment('MENSALIDADE DIA PARCELA 3/10')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'MENSALIDADE DIA',
    });
  });

  it('total acima de 12 nao pode ser mes: e parcela mesmo sem palavra-chave', () => {
    expect(detectInstallment('MOVEIS SIMONETTI 04/24')).toEqual({
      current: 4,
      total: 24,
      cleanDescription: 'MOVEIS SIMONETTI',
    });
    expect(detectInstallment('CELULAR 07/18')?.total).toBe(18);
  });

  it('linha remontada de PDF: a data da compra na frente nao rouba a parcela', () => {
    // Caso real do Santander (RF-IMP-12): a linha vem com data, descricao e
    // valor juntos. '10/09' cai sozinha no filtro 3 (dia 10 > mes 9), e sobra
    // uma candidata.
    expect(detectInstallment('10/09 SUPERMERCADO BOM PRECO 03/10 R$ 100,00')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: '10/09 SUPERMERCADO BOM PRECO R$ 100,00',
    });
  });

  it('linha remontada com data ambigua devolve null, que e o lado seguro', () => {
    // '03/09' e dia 3 de setembro, mas tambem fecha como parcela 3 de 9: duas
    // candidatas soltas, nenhum criterio para escolher. A parcela vira campo
    // vazio na tela de confirmacao, em vez de nove parcelas fantasma.
    expect(detectInstallment('03/09 SUPERMERCADO BOM PRECO 03/10 R$ 100,00')).toBeNull();
  });

  it('duas candidatas soltas sem palavra-chave devolvem null', () => {
    // Sem criterio para escolher, e escolher errado e o erro caro.
    expect(detectInstallment('PIZZA 1/2 GRANDE 03/10')).toBeNull();
  });

  it('com palavra-chave, a candidata marcada vence as soltas', () => {
    expect(detectInstallment('PARC 03/10 PIZZA 1/2')).toEqual({
      current: 3,
      total: 10,
      cleanDescription: 'PIZZA 1/2',
    });
  });
});

describe('detectInstallment — sem padrao', () => {
  it('devolve null quando nao ha marcador', () => {
    expect(detectInstallment('SUPERMERCADO BOM PRECO')).toBeNull();
    expect(detectInstallment('POSTO IPIRANGA 1234')).toBeNull();
    expect(detectInstallment('TRANSFERENCIA RECEBIDA')).toBeNull();
  });

  it('devolve null para plano que nao e plano', () => {
    // 1/1 e uma parcela unica — nao ha nada a projetar — e tambem e 1 de janeiro.
    expect(detectInstallment('COMPRA 1/1')).toBeNull();
    expect(detectInstallment('COMPRA 3/1')).toBeNull();
    expect(detectInstallment('COMPRA 0/10')).toBeNull();
  });

  it('devolve null para numero que nao e par de parcela', () => {
    expect(detectInstallment('CNPJ 100/120')).toBeNull();
    expect(detectInstallment('PROCESSO 2026/03')).toBeNull();
  });

  it('devolve null para entrada vazia ou malformada, sem lancar', () => {
    expect(detectInstallment('')).toBeNull();
    expect(detectInstallment('   ')).toBeNull();
    // `as`: o contrato tipa `string`, mas a descricao vem de arquivo lido na
    // borda — o teste garante que um valor indevido nao derruba o parser.
    expect(detectInstallment(undefined as unknown as string)).toBeNull();
    expect(detectInstallment(null as unknown as string)).toBeNull();
  });
});

describe('detectInstallment — pureza e reentrancia', () => {
  it('nao guarda estado entre chamadas', () => {
    // Regex global com `lastIndex` compartilhado devolveria null na segunda
    // chamada; `matchAll` nao mexe no original.
    const first = detectInstallment('LOJA A 03/10');
    const second = detectInstallment('LOJA B 03/10');
    expect(first).toEqual({ current: 3, total: 10, cleanDescription: 'LOJA A' });
    expect(second).toEqual({ current: 3, total: 10, cleanDescription: 'LOJA B' });
  });

  it('nao altera a descricao recebida', () => {
    const raw = 'NETFLIX - Parcela 3/12';
    detectInstallment(raw);
    expect(raw).toBe('NETFLIX - Parcela 3/12');
  });
});
