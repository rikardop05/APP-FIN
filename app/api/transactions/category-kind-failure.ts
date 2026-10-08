import { CategoryKindMismatchError } from '@/lib/db/queries/category-kind';

/**
 * Natureza x tipo -> resposta HTTP 400 com a mensagem em português do próprio erro (ela diz qual regra
 * e, no lote, quantos lançamentos não cabem). `null` = não é este erro. Sem importar a sessão, para o
 * teste exercitar o mapeamento. Compartilhado pelas rotas que categorizam à mão (criar, editar, lote).
 */
export function categoryKindFailure(error: unknown): { status: 400; error: string } | null {
  return error instanceof CategoryKindMismatchError ? { status: 400, error: error.message } : null;
}
