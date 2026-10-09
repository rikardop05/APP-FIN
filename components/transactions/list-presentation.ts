import { toCompetence } from '@/lib/date';

/**
 * Estado do CONTEUDO das listas de lancamentos.
 *
 * Decisao do Orquestrador (T-403): **com erro de carga, nao mostrar o estado
 * vazio.** O vazio e uma afirmacao ("nao ha lancamentos") e seria enganoso
 * quando a carga falhou — ha lancamentos, so nao carregaram. Com erro, so o
 * alerta com "Tentar novamente"; o vazio so aparece com carga bem-sucedida e
 * zero itens.
 *
 * Pura e fora do `.tsx` de proposito: o vitest deste repo nao transforma JSX,
 * entao a regra precisa morar num modulo testavel.
 */

export type ListContentState = 'loading' | 'error' | 'empty' | 'list';

/**
 * Ordem de precedencia:
 * 1. `loading` vence — uma recarga em andamento (inclusive apos um erro) mostra
 *    o carregando, nao o erro antigo;
 * 2. `failed` vence o vazio e a lista: erro de carga nunca vira "nenhum
 *    lancamento";
 * 3. sem erro, zero itens e o vazio; com itens, a lista.
 */
export function listContentState(input: {
  loading: boolean;
  failed: boolean;
  rowCount: number;
}): ListContentState {
  if (input.loading) return 'loading';
  if (input.failed) return 'error';
  return input.rowCount === 0 ? 'empty' : 'list';
}

/**
 * Ordem de exibição da lista (impeccable distill): o MÊS ATUAL primeiro, depois os meses passados,
 * e as parcelas FUTURAS no fim. O servidor ordena por data da compra, e uma parcela de novembro
 * comprada em setembro subia ao topo da tela, antes do que acabou de acontecer.
 *
 * O critério é a COMPETÊNCIA (o eixo do app), não a data da compra:
 * 1. competência atual: mais recente primeiro (`occurredOn` decrescente);
 * 2. competências passadas: da mais recente para a mais antiga, e dentro delas a data decrescente;
 * 3. competências futuras: da mais próxima para a mais distante (a data crescente).
 * Empate mantém a ordem recebida (ordenação estável, que o servidor já fez por data e criação).
 */
export function sortForDisplay<T extends { competence: string; occurredOn: string }>(
  rows: readonly T[],
  today: string,
): T[] {
  const current = toCompetence(today);
  const bucket = (row: T): number => (row.competence === current ? 0 : row.competence < current ? 1 : 2);
  return [...rows].sort((a, b) => {
    const byBucket = bucket(a) - bucket(b);
    if (byBucket !== 0) return byBucket;
    if (bucket(a) === 2) {
      if (a.competence !== b.competence) return a.competence < b.competence ? -1 : 1;
      return a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0;
    }
    if (bucket(a) === 1 && a.competence !== b.competence) return a.competence < b.competence ? 1 : -1;
    return a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0;
  });
}

/**
 * Numeração da parcela na lista. Com o total do plano vira `03/10` (componente `Parcela`); sem o total,
 * ou com número fora do plano (dado inconsistente, que `Parcela` rejeitaria), cai para texto simples.
 */
export function installmentLabel(number: number, total: number | null): { total: number | null; text: string } {
  if (total !== null && number >= 1 && number <= total) {
    return { total, text: `${String(number).padStart(Math.max(2, String(total).length), '0')}/${String(total).padStart(Math.max(2, String(total).length), '0')}` };
  }
  return { total: null, text: `parcela ${String(number).padStart(2, '0')}` };
}

/**
 * Tira da descrição o "(03/10)" ou "PARC 03/10" que o banco imprime quando o talão da linha JÁ mostra a
 * parcela (`Parcela`): a numeração não aparece duas vezes. Só tira o sufixo que bate com a parcela da
 * própria linha (número e total); qualquer outro texto fica como está.
 */
export function stripInstallmentSuffix(description: string, number: number, total: number | null): string {
  if (total === null) return description;
  const n = String(number);
  const t = String(total);
  const suffix = new RegExp(
    String.raw`\s*(?:\b(?:PARC(?:ELA)?\.?)\s*)?[(\[]?\s*0*${n}\s*(?:/|\s+DE\s+)\s*0*${t}\s*[)\]]?\s*$`,
    'i',
  );
  const stripped = description.replace(suffix, '').trimEnd();
  return stripped === '' ? description : stripped;
}

/** Só receita e despesa entram no total do mês (a regra da Sobra); o resto é movimento entre contas. */
function countsInSurplus(kind: string): boolean {
  return kind === 'income' || kind === 'expense';
}

/**
 * Agrupa as linhas (já na ordem de exibição) por competência, mantendo a ordem dos grupos e das linhas, e
 * soma o mês. O total é "receitas − despesas" em centavos (despesa negativa, receita positiva), pela MESMA
 * regra da Sobra do Painel (`monthlyKpis`): transferência, pagamento de fatura e aporte ficam FORA da soma.
 */
export function groupByCompetence<T extends { competence: string; amountCents: number; kind: string }>(
  rows: readonly T[],
): { competence: string; rows: T[]; totalCents: number }[] {
  const groups: { competence: string; rows: T[]; totalCents: number }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.competence === row.competence) {
      last.rows.push(row);
      last.totalCents += countsInSurplus(row.kind) ? row.amountCents : 0;
    } else {
      groups.push({ competence: row.competence, rows: [row], totalCents: countsInSurplus(row.kind) ? row.amountCents : 0 });
    }
  }
  return groups;
}

export type RowMarkLabel = 'Previsto' | 'Não categorizado';

/** Os estados que a linha carrega como selo: previsto (ainda não lançado) e sem categoria. */
export function rowMarkLabels(row: { status: string; categoryName: string | null }): RowMarkLabel[] {
  const labels: RowMarkLabel[] = [];
  if (row.status === 'planned') labels.push('Previsto');
  if (row.categoryName === null) labels.push('Não categorizado');
  return labels;
}

/**
 * Selos que a MAIORIA das linhas do mês (mais da metade, com 2 ou mais linhas) tem: sobem para o cabeçalho do
 * mês, com a contagem, em vez de se repetirem em cada canhoto. Na linha só fica selo quando ela difere do
 * grupo: quem tem o selo da maioria o perde (o cabeçalho já o diz); quem não tem, segue sem selo.
 */
export function commonMarks(
  rows: readonly { status: string; categoryName: string | null }[],
): { label: RowMarkLabel; count: number }[] {
  if (rows.length < 2) return [];
  const counts = new Map<RowMarkLabel, number>();
  for (const row of rows) for (const label of rowMarkLabels(row)) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count * 2 > rows.length).map(([label, count]) => ({ label, count }));
}
