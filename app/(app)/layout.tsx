import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { SidebarNav } from '@/components/nav/sidebar-nav';
import { BottomNav } from '@/components/nav/bottom-nav';
import { THEME_COOKIE, resolveTheme } from '@/components/nav/theme';

/**
 * Shell das telas autenticadas: nav lateral no desktop, inferior no celular.
 * As 9 rotas de SPEC §7 vivem sob este grupo, `/` inclusive: o T-115 trouxe o
 * dashboard para `app/(app)/page.tsx` e removeu a landing provisória do T-001.
 *
 * Acessibilidade: o primeiro foco da página é "Pular para o conteúdo", que leva ao `<main>`
 * sem atravessar as 9 rotas da navegação. No celular, o fundo do `<main>` soma a área segura
 * do iPhone (`env(safe-area-inset-bottom)`, 0 nos demais), a mesma que o BottomNav ocupa (`--bottom-nav-h`, em globals.css), e as
 * laterais usam `max(margem, env(safe-area-inset-left/right))` para o entalhe do iPhone deitado
 * (o iOS ignora a trava de retrato do manifesto). Sem entalhe, os valores são os de antes.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Mesmo cookie que o layout raiz lê: o seletor já nasce marcado no tema certo.
  const theme = resolveTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-[max(1rem,env(safe-area-inset-left))] focus:top-4 focus:z-50 focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Pular para o conteúdo
      </a>
      <SidebarNav theme={theme} />
      <main
        id="conteudo"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 pb-[calc(var(--bottom-nav-h)+2rem)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-6 focus:outline-none sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] md:pb-10"
      >
        {children}
      </main>
      <BottomNav theme={theme} />
    </div>
  );
}
