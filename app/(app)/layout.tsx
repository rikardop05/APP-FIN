import type { ReactNode } from 'react';
import { SidebarNav } from '@/components/nav/sidebar-nav';
import { BottomNav } from '@/components/nav/bottom-nav';

/**
 * Shell das telas autenticadas: nav lateral no desktop, inferior no celular.
 * As 9 rotas de SPEC §7 vivem sob este grupo, exceto `/`, que por enquanto
 * ainda é a landing provisória de `app/page.tsx` (T-001) — o T-115 move o
 * dashboard para `app/(app)/page.tsx` e a substitui.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <SidebarNav />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-24 pt-6 sm:px-6 md:pb-10">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
