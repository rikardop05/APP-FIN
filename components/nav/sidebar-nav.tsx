'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isNavItemActive } from './nav-items';
import { SignOutButton } from './sign-out-button';
import { ThemeToggle } from './theme-toggle';
import type { Theme } from './theme';

/**
 * Lombada do carnê: navegação lateral em tinta escura, visível a partir de `md`. Abaixo disso quem
 * navega é `BottomNav`. A marca é a única área de identidade da lombada (guilhochê sobre a tinta).
 */
export function SidebarNav({ theme }: { theme: Theme }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      // Presa à altura da janela (`sticky top-0 h-screen`): o "Sair" do rodapé fica à vista em
      // QUALQUER página, longa ou curta. Sem isso a barra crescia com o conteúdo e o botão ia
      // parar abaixo da dobra nas telas longas. Rola por dentro se a janela for baixa.
      className="hidden shrink-0 bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen md:w-60 md:flex-col md:gap-0.5 md:overflow-y-auto md:pb-6"
    >
      <div className="guilhoche-ink mb-4 border-b border-sidebar-border px-6 py-6">
        <span className="bg-sidebar px-1 text-lg font-semibold tracking-widest">APPFIN</span>
      </div>
      <div className="flex flex-col gap-0.5 px-3">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item.href, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-foreground',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-muted hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border pt-3">
        <ThemeToggle variant="sidebar" initialTheme={theme} />
        <div className="px-3">
          <SignOutButton variant="sidebar" />
        </div>
      </div>
    </nav>
  );
}
