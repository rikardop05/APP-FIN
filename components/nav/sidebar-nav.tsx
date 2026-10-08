'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isNavItemActive } from './nav-items';
import { SignOutButton } from './sign-out-button';

/** Navegação lateral, visível a partir de `md`. Abaixo disso quem navega é `BottomNav`. */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      // Presa à altura da janela (`sticky top-0 h-screen`): o "Sair" do rodapé fica à vista em
      // QUALQUER página, longa ou curta. Sem isso a barra crescia com o conteúdo e o botão ia
      // parar abaixo da dobra nas telas longas. Rola por dentro se a janela for baixa.
      className="hidden shrink-0 border-r border-border md:sticky md:top-0 md:flex md:h-screen md:w-56 md:flex-col md:gap-1 md:overflow-y-auto md:px-3 md:py-6"
    >
      <div className="px-3 pb-4 text-lg font-semibold tracking-tight text-foreground">
        APPFIN
      </div>
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item.href, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
      <div className="mt-auto border-t border-border pt-3">
        <SignOutButton variant="sidebar" />
      </div>
    </nav>
  );
}
