'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isNavItemActive } from './nav-items';
import { SignOutButton } from './sign-out-button';

/** Quantas rotas cabem confortavelmente como toque direto em 390 px; o resto vai para "Mais". */
const PRIMARY_COUNT = 4;

const OVERFLOW_PANEL_ID = 'bottom-nav-overflow';

/**
 * Navegação inferior, visível abaixo de `md`. As 9 rotas de SPEC §7 continuam
 * todas alcançáveis: as 4 primeiras como toque direto, as demais atrás do
 * botão "Mais" — 9 abas lado a lado não caberiam com alvo de toque legível em
 * 390 px.
 *
 * O painel do "Mais" é navegação revelada, não um menu de comandos — por isso
 * é `<nav>`, não `role="menu"` (que exigiria filhos `menuitem` e o contrato de
 * teclado de setas/Home/End). Fecha com Escape e devolve o foco ao botão que
 * o abriu.
 *
 * Área segura do iPhone: a barra cresce `env(safe-area-inset-bottom)` para baixo (com o
 * `viewport-fit=cover` do layout raiz), e os ícones ficam acima do indicador de início. Em
 * aparelhos sem essa faixa o env() vale 0 e nada muda. O painel do "Mais" e o rodapé fixo da
 * confirmação de importação usam a mesma soma, `4rem + env(safe-area-inset-bottom)`.
 */
export function BottomNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstOverflowLinkRef = useRef<HTMLAnchorElement>(null);

  const primary = NAV_ITEMS.slice(0, PRIMARY_COUNT);
  const overflow = NAV_ITEMS.slice(PRIMARY_COUNT);
  const overflowActive = overflow.some((item) =>
    isNavItemActive(item.href, pathname),
  );

  useEffect(() => {
    if (!open) return;
    firstOverflowLinkRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
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
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={closeAndReturnFocus}
            className="absolute inset-0 bg-foreground/20"
          />
          <nav
            id={OVERFLOW_PANEL_ID}
            aria-label="Mais opções de navegação"
            className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] max-h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] overflow-y-auto rounded-t-lg border-t border-border bg-background p-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] shadow-lg"
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-medium text-foreground">
                Mais opções
              </span>
              <button
                type="button"
                onClick={closeAndReturnFocus}
                aria-label="Fechar"
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
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
                      'flex flex-col items-center gap-1 rounded-md px-2 py-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
              <SignOutButton variant="tile" />
            </div>
          </nav>
        </div>
      ) : null}

      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(4rem+env(safe-area-inset-bottom))] border-t border-border bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden"
      >
        {primary.map((item) => {
          const active = isNavItemActive(item.href, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={OVERFLOW_PANEL_ID}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            open || overflowActive ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          Mais
        </button>
      </nav>
    </>
  );
}
