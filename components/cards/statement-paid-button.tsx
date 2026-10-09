'use client';

import { useState } from 'react';

import { competenceShort } from '@/components/cashflow/labels';
import { Button } from '@/components/ui-kit';

import {
  PAID_NETWORK_ERROR,
  paidButtonAriaLabel,
  paidButtonLabel,
  paidErrorMessage,
  paidSuccessMessage,
  statementStatusResponseSchema,
  targetStatus,
  type StatementStatus,
} from './statement-paid';

type StatementPaidButtonProps = {
  statement: { id: string; period: string; status: StatementStatus };
  /** Depois de gravar: a tela recarrega as faturas e o servidor refaz o comprometido. */
  onChanged: () => void;
};

/**
 * Marca e desmarca a fatura como paga (rota do Funil). Grava só ao clicar, sem confirmar em dois
 * passos: é reversível pelo mesmo botão. O resultado é dito em texto (`role="status"`), o erro em
 * `role="alert"`. A tela recarrega as faturas sem desmontar a lista, então a mensagem fica visível.
 */
export function StatementPaidButton({ statement, onChanged }: StatementPaidButtonProps) {
  const { id: statementId, period, status } = statement;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  async function toggle() {
    const next = targetStatus(status);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/statements/${statementId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !statementStatusResponseSchema.safeParse(body).success) {
        setMessage({ kind: 'error', text: paidErrorMessage(response.ok ? null : response.status, body) });
        return;
      }
      setMessage({ kind: 'success', text: paidSuccessMessage(next) });
      onChanged();
    } catch {
      setMessage({ kind: 'error', text: PAID_NETWORK_ERROR });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        aria-label={paidButtonAriaLabel(status, competenceShort(period))}
        onClick={() => void toggle()}
      >
        {busy ? 'Salvando…' : paidButtonLabel(status)}
      </Button>
      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={message.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
