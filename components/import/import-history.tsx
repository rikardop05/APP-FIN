'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, History, Undo2 } from 'lucide-react';

import { Badge, Button } from '@/components/ui-kit';
import { formatDateBR } from '@/lib/date';

import { ImportHistoryEmptyState } from './import-history-empty-state';
import { apiErrorSchema } from './schemas';
import {
  importBatchesResponseSchema,
  revertResponseSchema,
  type ImportBatchHistoryItem,
} from './import-history-schemas';

type ImportHistoryProps = {
  /**
   * Incrementado pelo ImportScreen após uma confirmação bem-sucedida, para
   * forçar refetch do histórico sem precisar de um store global. O número em
   * si não importa; a troca de identidade, sim.
   */
  refreshKey: number;
};

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; batches: ImportBatchHistoryItem[] }
  | { kind: 'error'; message: string };

type RevertState =
  | { kind: 'idle' }
  | { kind: 'confirming'; batchId: string }
  | { kind: 'reverting'; batchId: string }
  | { kind: 'reverted'; batchId: string; transactionsDeleted: number }
  | { kind: 'error'; batchId: string; message: string };

function statusLabel(status: ImportBatchHistoryItem['status']): string {
  if (status === 'committed') return 'Confirmada';
  if (status === 'reverted') return 'Desfeita';
  if (status === 'pending') return 'Pendente';
  return 'Falhou';
}

function statusVariant(
  status: ImportBatchHistoryItem['status'],
): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'committed') return 'success';
  if (status === 'reverted') return 'neutral';
  if (status === 'pending') return 'warning';
  return 'danger';
}

function rowCountLabel(rowsImported: number): string {
  if (rowsImported === 1) return '1 lançamento';
  return `${rowsImported} lançamentos`;
}

/**
 * Texto da confirmação explícita do desfazer. Carrega o NÚMERO de linhas e a
 * DATA do lote — é o que dá ao usuário a percepção de "qual lote" ele está
 * prestes a apagar ANTES de confirmar, em vez do genérico "Tem certeza?".
 *
 * Ex.: "Desfazer importação de 12/09/2026 com 47 lançamentos?"
 *      "Desfazer importação de 03/01/2026 com 1 lançamento?"
 *
 * Lote com 0 linhas é improvável (commit não grava 0), mas tratado —
 * mantém a frase coerente se acontecer por estado inconsistente.
 */
function revertPrompt(batch: ImportBatchHistoryItem): string {
  const date = formatDateBR(batch.createdAt.slice(0, 10));
  return `Desfazer importação de ${date} com ${rowCountLabel(batch.rowsImported)}?`;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : fallback;
}

export function ImportHistory({ refreshKey }: ImportHistoryProps) {
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [revertState, setRevertState] = useState<RevertState>({ kind: 'idle' });

  const refetch = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const response = await fetch('/api/import/history', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(
          await readApiError(response, 'Não foi possível carregar o histórico.'),
        );
      }
      const body = importBatchesResponseSchema.parse(await response.json());
      setState({ kind: 'ready', batches: body.batches });
    } catch (cause) {
      setState({
        kind: 'error',
        message:
          cause instanceof Error
            ? cause.message
            : 'Não foi possível carregar o histórico.',
      });
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch, refreshKey]);

  const confirmingBatch = useMemo(() => {
    if (revertState.kind !== 'confirming' && revertState.kind !== 'reverting') return null;
    if (state.kind !== 'ready') return null;
    return state.batches.find((batch) => batch.id === revertState.batchId) ?? null;
  }, [revertState, state]);

  function startConfirm(batchId: string) {
    setRevertState({ kind: 'confirming', batchId });
  }

  function cancelConfirm() {
    if (revertState.kind === 'reverting') return;
    setRevertState({ kind: 'idle' });
  }

  async function confirmRevert() {
    if (revertState.kind !== 'confirming') return;
    const { batchId } = revertState;
    setRevertState({ kind: 'reverting', batchId });
    try {
      const response = await fetch('/api/import/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(body);
        const message = parsedError.success
          ? parsedError.data.error
          : 'Não foi possível desfazer a importação.';
        throw new Error(message);
      }
      const result = revertResponseSchema.parse(body);
      setRevertState({
        kind: 'reverted',
        batchId,
        transactionsDeleted: result.transactionsDeleted,
      });
      await refetch();
    } catch (cause) {
      setRevertState({
        kind: 'error',
        batchId,
        message:
          cause instanceof Error
            ? cause.message
            : 'Não foi possível desfazer a importação.',
      });
    }
  }

  return (
    <section
      aria-label="Histórico de importações"
      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <History className="h-5 w-5" aria-hidden="true" />
          Histórico de importações
        </h2>
        <p className="text-sm text-muted-foreground">
          Cada lote pode ser desfeito — a confirmação mostra a data e quantos
          lançamentos serão apagados.
        </p>
      </div>

      {state.kind === 'loading' || state.kind === 'idle' ? (
        <p className="text-sm text-muted-foreground">Carregando histórico…</p>
      ) : null}

      {state.kind === 'error' ? (
        <div role="alert" className="flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{state.message}</span>
        </div>
      ) : null}

      {state.kind === 'ready' && state.batches.length === 0 ? (
        <ImportHistoryEmptyState />
      ) : null}

      {state.kind === 'ready' && state.batches.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {state.batches.map((batch) => {
            const isConfirming =
              revertState.kind === 'confirming' && revertState.batchId === batch.id;
            const isReverting =
              revertState.kind === 'reverting' && revertState.batchId === batch.id;
            const revertError =
              revertState.kind === 'error' && revertState.batchId === batch.id
                ? revertState.message
                : null;
            const justReverted =
              revertState.kind === 'reverted' && revertState.batchId === batch.id;
            const canRevert = batch.status === 'committed';
            return (
              <li
                key={batch.id}
                className="rounded-lg border border-border bg-background p-3 sm:p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {batch.fileName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {rowCountLabel(batch.rowsImported)}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDateBR(batch.createdAt.slice(0, 10))}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={statusVariant(batch.status)}>
                      {statusLabel(batch.status)}
                    </Badge>
                    {canRevert ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => startConfirm(batch.id)}
                        disabled={isReverting}
                        aria-label={`Desfazer importação de ${batch.fileName}`}
                      >
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Desfazer
                      </Button>
                    ) : null}
                  </div>
                </div>

                {isConfirming && confirmingBatch ? (
                  <div
                    role="alertdialog"
                    aria-label="Confirmar desfazer importação"
                    className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
                  >
                    <p className="font-medium">{revertPrompt(confirmingBatch)}</p>
                    <p className="mt-1 text-xs text-amber-900/80">
                      Esta ação remove os lançamentos do lote. O histórico do
                      lote é preservado como desfeito.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={cancelConfirm}
                        disabled={isReverting}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void confirmRevert()}
                        disabled={isReverting}
                      >
                        {isReverting ? 'Desfazendo…' : 'Confirmar desfazer'}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {revertError ? (
                  <div
                    role="alert"
                    className="mt-3 flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{revertError}</span>
                  </div>
                ) : null}

                {justReverted ? (
                  <p className="mt-2 text-xs text-emerald-700">
                    Lote desfeito. Recarregue a tela de lançamentos para ver
                    os números atualizados.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
