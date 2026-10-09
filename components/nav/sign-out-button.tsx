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
          ? 'flex min-h-11 w-full items-center gap-3 px-3 text-sm font-medium text-sidebar-muted transition-colors hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-foreground disabled:opacity-50'
          : 'flex min-h-[44px] flex-col items-center justify-center gap-1 border border-border bg-card px-2 py-3 text-xs font-medium text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
      )}
    >
      <LogOut className={variant === 'sidebar' ? 'h-4 w-4 shrink-0' : 'h-5 w-5'} aria-hidden="true" />
      {pending ? 'Saindo…' : 'Sair'}
    </button>
  );
}
