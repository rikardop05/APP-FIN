'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button, Input, Money } from '@/components/ui-kit';
import type { Cents } from '@/lib/money';

import { parsePaymentChoice, type PaymentChoice } from './statement-paid';

/**
 * Dialogo de "Marcar como paga": Integral (padrao, com o total da fatura) ou Outro valor.
 * Grava so ao confirmar. Foco no primeiro radio ao abrir, Esc cancela, Tab fica dentro do dialogo.
 */
export function PaymentDialog({
  total,
  periodLabel,
  busy,
  serverError,
  onCancel,
  onConfirm,
}: {
  total: Cents;
  periodLabel: string;
  busy: boolean;
  /** Erro da API, dito DENTRO do dialogo (atras do overlay ninguem o ve). */
  serverError?: string | null;
  onCancel: () => void;
  onConfirm: (paidAmountCents: number | undefined) => void;
}) {
  const [choice, setChoice] = useState<PaymentChoice>({ mode: 'full', text: '' });
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fullRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Foco volta ao botao que abriu o dialogo quando ele fecha.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fullRef.current?.focus();
    return () => {
      if (opener?.isConnected === true) opener.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (event.key !== 'Tab' || panelRef.current === null) return;
    // Radio nao marcado nao e parada de Tab (so o marcado do grupo e): fora da lista, senao o
    // Shift+Tab do radio "Outro valor" escaparia do dialogo.
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])')].filter(
      (element) => !(element instanceof HTMLInputElement && element.type === 'radio' && !element.checked),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (!panelRef.current.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function submit() {
    const parsed = parsePaymentChoice(choice);
    if (!parsed.ok) {
      setError(parsed.error);
      panelRef.current?.querySelector<HTMLInputElement>('#payment-amount')?.focus();
      return;
    }
    setError(null);
    onConfirm(parsed.paidAmountCents);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
        className="w-full border border-border bg-background p-4 shadow-lg sm:max-w-md sm:p-6"
      >
        <h2 id="payment-dialog-title" className="text-lg font-semibold">
          Marcar fatura de {periodLabel} como paga
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Quanto foi pago desta fatura?</p>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              ref={fullRef}
              type="radio"
              name="payment-mode"
              className="size-4"
              checked={choice.mode === 'full'}
              onChange={() => {
                setChoice({ ...choice, mode: 'full' });
                setError(null);
              }}
            />
            <span>
              Integral (<Money value={total} sign="never" />)
            </span>
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="radio"
              name="payment-mode"
              className="size-4"
              checked={choice.mode === 'custom'}
              onChange={() => {
                setChoice({ ...choice, mode: 'custom' });
                window.setTimeout(() => panelRef.current?.querySelector<HTMLInputElement>('#payment-amount')?.focus(), 0);
              }}
            />
            <span>Outro valor</span>
          </label>
          {choice.mode === 'custom' ? (
            <div className="flex flex-col gap-1 pl-7">
              <label htmlFor="payment-amount" className="text-sm font-medium">
                Valor pago
              </label>
              <Input
                id="payment-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                value={choice.text}
                aria-invalid={error !== null}
                aria-describedby={error !== null ? 'payment-amount-error' : undefined}
                onChange={(event) => {
                  setChoice({ mode: 'custom', text: event.target.value });
                  setError(null);
                }}
              />
              {error !== null ? (
                <p id="payment-amount-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
          {serverError ? (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          ) : null}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Salvando…' : 'Confirmar'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
