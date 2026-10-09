'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Undo2 } from 'lucide-react';

import { Button, Faixa, Selo, type SeloTone } from '@/components/ui-kit';
import { formatDateBR } from '@/lib/date';

import { ImportHistoryEmptyState } from './import-history-empty-state';
import {
  batchRowsText,
  batchStatusLabel,
  batchTitle,
  revertedMessage,
  rowCountLabel,
} from './import-history-text';
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

function statusTone(status: ImportBatchHistoryItem['status']): SeloTone {
  if (status === 'committed') return 'ok';
  if (status === 'reverted') return 'neutral';
  if (status === 'pending') return 'attention';
  return 'danger';
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

const revertTriggerId = (batchId: string) => `revert-trigger-${batchId}`;
const revertCancelId = (batchId: string) => `revert-cancel-${batchId}`;
const revertDialogId = (batchId: string) => `revert-dialog-${batchId}`;

async function readApiError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : fallback;
}

export function ImportHistory({ refreshKey }: ImportHistoryProps) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [revertState, setRevertState] = useState<RevertState>({ kind: 'idle' });
  // Foco do alertdialog: entra no "Cancelar" ao abrir (a opção que não apaga nada) e
  // volta ao botão "Desfazer" do lote ao fechar. Depois de desfazer, o botão some (o lote
  // deixa de ser "Confirmada"), então o foco vai para a mensagem de resultado.
  // Por id, não por ref: o `Button` do ui-kit não repassa ref.
  const resultRef = useRef<HTMLParagraphElement>(null);
  const returnFocusTo = useRef<string | null>(null);

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

  useEffect(() => {
    if (revertState.kind === 'confirming') {
      document.getElementById(revertCancelId(revertState.batchId))?.focus();
    } else if (revertState.kind === 'reverting') {
      // Os botões ficam desabilitados e perderiam o foco para o <body>: o foco fica no diálogo.
      document.getElementById(revertDialogId(revertState.batchId))?.focus();
    } else if (revertState.kind === 'reverted') {
      resultRef.current?.focus();
      returnFocusTo.current = null;
    } else if ((revertState.kind === 'idle' || revertState.kind === 'error') && returnFocusTo.current !== null) {
      document.getElementById(revertTriggerId(returnFocusTo.current))?.focus();
      returnFocusTo.current = null;
    }
  }, [revertState]);

  function startConfirm(batchId: string) {
    returnFocusTo.current = batchId;
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
      // Os números das outras telas (lançamentos, painel, fluxo) passam a refletir o lote
      // desfeito sem a pessoa recarregar nada.
      router.refresh();
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
    <section aria-label="Histórico de importações" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Histórico de importações</h2>
        <p className="text-sm text-muted-foreground">
          Cada lote pode ser desfeito — a confirmação mostra a data e quantos
          lançamentos serão apagados.
        </p>
      </div>

      {state.kind === 'loading' || state.kind === 'idle' ? (
        <p className="text-sm text-muted-foreground">Carregando histórico…</p>
      ) : null}

      {state.kind === 'error' ? (
        <Faixa tone="danger" role="alert">
          <span>{state.message}</span>
        </Faixa>
      ) : null}

      {state.kind === 'ready' && state.batches.length === 0 ? (
        <ImportHistoryEmptyState />
      ) : null}

      {state.kind === 'ready' && state.batches.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {state.batches.map((batch) => {
            // O diálogo fica aberto também enquanto desfaz: some só com o resultado.
            const isConfirming =
              (revertState.kind === 'confirming' || revertState.kind === 'reverting') &&
              revertState.batchId === batch.id;
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
              <li key={batch.id} className="border border-border bg-card p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {batchTitle(batch)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {batchRowsText(batch.status, batch.rowsImported)}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDateBR(batch.createdAt.slice(0, 10))}
                      {batchTitle(batch) === batch.fileName ? '' : ` · ${batch.fileName}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Selo tone={statusTone(batch.status)} label={batchStatusLabel(batch.status)} />
                    {canRevert ? (
                      <Button
                        id={revertTriggerId(batch.id)}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => startConfirm(batch.id)}
                        disabled={isReverting}
                        aria-label={`Desfazer importação de ${batch.fileName}`}
                      >
                        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Desfazer
                      </Button>
                    ) : null}
                  </div>
                </div>

                {isConfirming && confirmingBatch ? (
                  <div
                    id={revertDialogId(batch.id)}
                    tabIndex={-1}
                    aria-busy={isReverting}
                    role="alertdialog"
                    aria-labelledby={`revert-prompt-${batch.id}`}
                    aria-describedby={`revert-detail-${batch.id}`}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') cancelConfirm();
                    }}
                    className="mt-3 border border-warning bg-warning-soft p-3 text-sm text-foreground"
                  >
                    <p id={`revert-prompt-${batch.id}`} className="font-medium">{revertPrompt(confirmingBatch)}</p>
                    <p id={`revert-detail-${batch.id}`} className="mt-1 text-xs text-muted-foreground">
                      Esta ação remove os lançamentos do lote. O histórico do
                      lote é preservado como desfeito.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        id={revertCancelId(batch.id)}
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
                  <Faixa tone="danger" role="alert" className="mt-3">
                    <span>{revertError}</span>
                  </Faixa>
                ) : null}

                {justReverted && revertState.kind === 'reverted' ? (
                  <p ref={resultRef} tabIndex={-1} role="status" className="mt-2 text-xs font-medium text-success">
                    {revertedMessage(revertState.transactionsDeleted)}
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
