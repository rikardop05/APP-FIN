'use client';

import { useTransition } from 'react';
import { LogOut } from 'lucide-react';

import { signOutAction } from '@/app/(auth)/logout/actions';
import { clearOfflineCache } from '@/components/pwa/pwa-register';
import { cn } from '@/lib/utils';

type SignOutButtonProps = {
  /** `sidebar`: linha da barra lateral (desktop). `tile`: bloco do menu "Mais" (celular). */
  variant: 'sidebar' | 'tile';
};

/**
 * Botao "Sair" (T-403). Primeiro apaga o cache offline do aparelho (o service worker confirma ou
 * o tempo esgota), so depois encerra a sessao: celular emprestado nao mostra as financas depois
 * de sair. A acao de servidor redireciona para `/login`.
 */
export function SignOutButton({ variant }: SignOutButtonProps) {
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      await clearOfflineCache();
      await signOutAction();
    });
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className={cn(
        variant === 'sidebar'
          ? 'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground disabled:opacity-50'
          : 'flex flex-col items-center gap-1 rounded-md px-2 py-3 text-xs font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-50',
      )}
    >
      <LogOut className={variant === 'sidebar' ? 'h-4 w-4 shrink-0' : 'h-5 w-5'} aria-hidden="true" />
      {pending ? 'Saindo…' : 'Sair'}
    </button>
  );
}
