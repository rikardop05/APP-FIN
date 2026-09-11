'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, isNavItemActive } from './nav-items';

/** Navegação lateral, visível a partir de `md`. Abaixo disso quem navega é `BottomNav`. */
export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className="hidden shrink-0 border-r border-border md:flex md:w-56 md:flex-col md:gap-1 md:px-3 md:py-6"
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
    </nav>
  );
}
