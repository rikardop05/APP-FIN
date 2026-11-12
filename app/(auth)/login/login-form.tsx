'use client';

import { useActionState } from 'react';

import { Button, Input } from '@/components/ui-kit';

import { requestMagicLink } from './actions';
import {
  INITIAL_MAGIC_LINK_STATE,
  messageForStatus,
} from './magic-link-state';

/**
 * Formulário de login: um campo de e-mail e um botão. Sem cadastro, sem senha,
 * sem "criar conta" — o acesso é só a allowlist (RNF-01).
 */
export function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    requestMagicLink,
    INITIAL_MAGIC_LINK_STATE,
  );

  const message = messageForStatus(state);
  const isError = state.status === 'error';

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="email">
        E-mail
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="voce@exemplo.com"
        />
      </label>

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Enviando…' : 'Receber link de acesso'}
      </Button>

      {message ? (
        <p
          role={isError ? 'alert' : 'status'}
          aria-live="polite"
          className={
            isError
              ? 'text-sm text-destructive'
              : 'text-sm text-muted-foreground'
          }
        >
          {message}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Só os dois e-mails cadastrados entram. Sem link no e-mail, ninguém
        acessa.
      </p>
    </form>
  );
}
