import type { ReactNode } from 'react';
import { SidebarNav } from '@/components/nav/sidebar-nav';
import { BottomNav } from '@/components/nav/bottom-nav';

/**
 * Shell das telas autenticadas: nav lateral no desktop, inferior no celular.
 * As 9 rotas de SPEC §7 vivem sob este grupo, `/` inclusive: o T-115 trouxe o
 * dashboard para `app/(app)/page.tsx` e removeu a landing provisória do T-001.
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
