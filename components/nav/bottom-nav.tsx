'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isNavItemActive } from './nav-items';
import { SignOutButton } from './sign-out-button';
import { ThemeToggle } from './theme-toggle';
import type { Theme } from './theme';

const OVERFLOW_PANEL_ID = 'bottom-nav-overflow';

/** Alvo de toque de 44px ou mais, rótulo de 12px (piso do mundo), indicador de ativo na régua de cima. */
const TAB_CLASS =
  'relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

/**
 * Navegação inferior, visível abaixo de `md`. As 9 rotas de SPEC §7 continuam todas alcançáveis: as
 * marcadas `mobile: 'primary'` em `nav-items.ts` (Painel, Lançamentos, Cartões, Fluxo) como toque
 * direto, as demais atrás do botão "Mais" (9 abas lado a lado não caberiam com alvo legível em 390px).
 *
 * O painel do "Mais" é navegação revelada, não um menu de comandos: por isso é `<nav>`, não
 * `role="menu"`. Fecha com Escape e devolve o foco ao botão que o abriu.
 *
 * Área segura do iPhone: a barra cresce `env(safe-area-inset-bottom)` para baixo (com o
 * `viewport-fit=cover` do layout raiz). A altura total é a variável `--bottom-nav-h` (globals.css),
 * a mesma que o painel do "Mais" e o rodapé fixo das telas (`Placar`) somam.
 */
export function BottomNav({ theme }: { theme: Theme }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstOverflowLinkRef = useRef<HTMLAnchorElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const primary = NAV_ITEMS.filter((item) => item.mobile === 'primary');
  const overflow = NAV_ITEMS.filter((item) => item.mobile === 'more');
  const overflowActive = overflow.some((item) => isNavItemActive(item.href, pathname));

  useEffect(() => {
    if (!open) return;
    firstOverflowLinkRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      // Focus trap: com o painel aberto (aria-modal), o Tab circula só dentro dele.
      if (event.key !== 'Tab' || panelRef.current === null) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      if (!panelRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  function closeAndReturnFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Mais opções de navegação" className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            tabIndex={-1}
            onClick={closeAndReturnFocus}
            className="absolute inset-0 bg-foreground/30"
          />
          <nav
            id={OVERFLOW_PANEL_ID}
            ref={panelRef}
            aria-label="Mais opções"
            className="absolute inset-x-0 bottom-[var(--bottom-nav-h)] max-h-[calc(100dvh-var(--bottom-nav-h))] overflow-y-auto border-t-2 border-foreground bg-background p-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-foreground">Mais opções</span>
              <button
                type="button"
                onClick={closeAndReturnFocus}
                aria-label="Fechar"
                className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="picote mb-3" aria-hidden="true" />
            <div className="grid grid-cols-3 gap-2">
              {overflow.map((item, index) => {
                const active = isNavItemActive(item.href, pathname);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    ref={index === 0 ? firstOverflowLinkRef : undefined}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-[44px] flex-col items-center justify-center gap-1 border px-2 py-3 text-center text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'border-primary bg-card text-primary'
                        : 'border-border bg-card text-foreground hover:bg-secondary/60',
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
              <SignOutButton variant="tile" />
            </div>
            <div className="mt-3 border-t border-border pt-3">
              <ThemeToggle variant="panel" initialTheme={theme} />
            </div>
          </nav>
        </div>
      ) : null}

      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--bottom-nav-h)] border-t border-border bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden"
      >
        {primary.map((item) => {
          const active = isNavItemActive(item.href, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(TAB_CLASS, active ? 'text-primary' : 'text-muted-foreground')}
            >
              {active ? (
                <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 bg-primary" />
              ) : null}
              <Icon className="h-5 w-5" aria-hidden="true" />
              {item.short ?? item.label}
            </Link>
          );
        })}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={OVERFLOW_PANEL_ID}
          className={cn(TAB_CLASS, open || overflowActive ? 'text-primary' : 'text-muted-foreground')}
        >
          {overflowActive && !open ? (
            <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 bg-primary" />
          ) : null}
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          Mais
        </button>
      </nav>
    </>
  );
}
