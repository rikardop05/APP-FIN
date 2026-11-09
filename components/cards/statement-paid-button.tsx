'use client';

import { useState } from 'react';

import { competenceShort } from '@/components/cashflow/labels';
import { Button } from '@/components/ui-kit';
import type { Cents } from '@/lib/money';

import { PaymentDialog } from './payment-dialog';
import {
  PAID_NETWORK_ERROR,
  paidButtonAriaLabel,
  paidButtonLabel,
  paidErrorMessage,
  paidSuccessMessage,
  statusRequestBody,
  statementStatusResponseSchema,
  targetStatus,
  type StatementStatus,
} from './statement-paid';

type StatementPaidButtonProps = {
  statement: { id: string; period: string; status: StatementStatus; computedTotalCents: Cents };
  /** Nome do cartão: âncora de contexto junto do botão (no celular, o cabeçalho da fatura fica longe). */
  cardName?: string;
  /** Depois de gravar: a tela recarrega as faturas e o servidor refaz o comprometido. */
  onChanged: () => void;
};

/**
 * Marca e desmarca a fatura como paga (rota do Funil). Grava só ao clicar, sem confirmar em dois
 * passos: é reversível pelo mesmo botão. O resultado é dito em texto (`role="status"`), o erro em
 * `role="alert"`. A tela recarrega as faturas sem desmontar a lista, então a mensagem fica visível.
 */
export function StatementPaidButton({ statement, cardName, onChanged }: StatementPaidButtonProps) {
  const { id: statementId, period, status } = statement;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  function onButtonClick() {
    // Marcar abre o dialogo (integral ou outro valor); desmarcar segue direto, como antes.
    if (targetStatus(status) === 'paid') {
      setDialogError(null);
      setDialogOpen(true);
    }
    else void send('open');
  }

  async function send(next: 'paid' | 'open', paidAmountCents?: number) {
    setBusy(true);
    setMessage(null);
    setDialogError(null);
    try {
      const response = await fetch(`/api/statements/${statementId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(statusRequestBody(next, paidAmountCents)),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !statementStatusResponseSchema.safeParse(body).success) {
        const text = paidErrorMessage(response.ok ? null : response.status, body);
        if (next === 'paid') setDialogError(text);
        else setMessage({ kind: 'error', text });
        return;
      }
      setMessage({ kind: 'success', text: paidSuccessMessage(next, paidAmountCents !== undefined) });
      setDialogOpen(false);
      onChanged();
    } catch {
      if (next === 'paid') setDialogError(PAID_NETWORK_ERROR);
      else setMessage({ kind: 'error', text: PAID_NETWORK_ERROR });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {cardName ? (
        <span className="text-xs text-muted-foreground sm:hidden">
          {cardName} · {competenceShort(period)}
        </span>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        aria-label={paidButtonAriaLabel(status, competenceShort(period), cardName)}
        onClick={onButtonClick}
      >
        {busy ? 'Salvando…' : paidButtonLabel(status)}
      </Button>
      {dialogOpen ? (
        <PaymentDialog
          total={statement.computedTotalCents}
          periodLabel={competenceShort(period)}
          busy={busy}
          serverError={dialogError}
          onCancel={() => setDialogOpen(false)}
          onConfirm={(paidAmountCents) => void send('paid', paidAmountCents)}
        />
      ) : null}
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
