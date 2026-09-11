'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatInteger } from '@/lib/i18n/format';

export type DataTableColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Presente = coluna ordenável. Devolve o valor primitivo usado na comparação. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
  className?: string;
};

type SortState = {
  columnId: string;
  direction: 'asc' | 'desc';
};

type DataTableProps<T> = {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  getRowId: (row: T) => string;
  pageSize?: number;
  /** Estado vazio. Passe um `<EmptyState>` com ação primária — regra 9 do T-005 vale aqui também. */
  empty?: ReactNode;
};

/**
 * Tabela base com ordenação por coluna e paginação client-side. Não sabe nada
 * de domínio financeiro — recebe colunas e linhas já prontas; quem popula é a
 * tela dona de cada rota.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  pageSize = 20,
  empty,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(() => {
    if (sort === null) return rows;
    const column = columns.find((candidate) => candidate.id === sort.columnId);
    const sortValue = column?.sortValue;
    if (!sortValue) return rows;

    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const valueA = sortValue(a);
      const valueB = sortValue(b);
      // Texto ordena por collation pt-BR (localeCompare), não por code point:
      // `<`/`>` puxariam toda descrição acentuada para depois de "Z".
      if (typeof valueA === 'string' && typeof valueB === 'string') {
        return valueA.localeCompare(valueB, 'pt-BR') * factor;
      }
      if (valueA < valueB) return -1 * factor;
      if (valueA > valueB) return 1 * factor;
      return 0;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = sortedRows.slice(
    currentPage * pageSize,
    currentPage * pageSize + pageSize,
  );

  function toggleSort(columnId: string) {
    setSort((previous) => {
      if (previous === null || previous.columnId !== columnId) {
        return { columnId, direction: 'asc' };
      }
      if (previous.direction === 'asc') {
        return { columnId, direction: 'desc' };
      }
      return null;
    });
    setPage(0);
  }

  if (rows.length === 0) {
    return (
      empty ?? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum registro.
        </p>
      )
    );
  }

  const from = currentPage * pageSize + 1;
  const to = currentPage * pageSize + pageRows.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              {columns.map((column) => {
                const active = sort?.columnId === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      column.sortValue
                        ? active
                          ? sort?.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                        : undefined
                    }
                    className={cn(
                      'px-3 py-2 font-medium',
                      column.align === 'right' && 'text-right',
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.id)}
                        className={cn(
                          'inline-flex items-center gap-1 hover:text-foreground',
                          active && 'text-foreground',
                        )}
                      >
                        {column.header}
                        <span aria-hidden="true">
                          {active ? (sort?.direction === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={getRowId(row)} className="border-b border-border last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      'px-3 py-2 align-middle',
                      column.align === 'right' && 'text-right',
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {formatInteger(from)}–{formatInteger(to)} de{' '}
            {formatInteger(sortedRows.length)}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              disabled={currentPage === 0}
              className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>
              Página {formatInteger(currentPage + 1)} de{' '}
              {formatInteger(pageCount)}
            </span>
            <button
              type="button"
              onClick={() =>
                setPage((current) => Math.min(pageCount - 1, current + 1))
              }
              disabled={currentPage >= pageCount - 1}
              className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
