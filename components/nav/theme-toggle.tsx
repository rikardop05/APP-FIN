'use client';

import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { themeCookie, THEME_COLOR, type Theme } from './theme';

type ThemeToggleProps = {
  /** `sidebar`: sobre a lombada (desktop). `panel`: dentro do painel "Mais" (celular). */
  variant: 'sidebar' | 'panel';
  /** Tema lido do cookie no servidor: o primeiro quadro já marca o certo. */
  initialTheme: Theme;
};

const OPTIONS: Array<{ theme: Theme; label: string; Icon: typeof Moon }> = [
  { theme: 'dark', label: 'Escuro', Icon: Moon },
  { theme: 'light', label: 'Claro', Icon: Sun },
];

/**
 * Seletor de tema: Escuro (o padrão) ou Claro. A escolha vai para o cookie `theme`, que o servidor
 * lê no próximo carregamento (sem piscar), e vale já: o atributo do <html> muda na hora.
 */
export function ThemeToggle({ variant, initialTheme }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  function choose(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    document.cookie = themeCookie(next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[next]);
  }

  return (
    <div role="group" aria-label="Tema" className={cn('flex flex-col gap-1', variant === 'sidebar' && 'px-3 pb-2')}>
      <span className={cn('text-xs', variant === 'sidebar' ? 'text-sidebar-muted' : 'text-muted-foreground')}>Tema</span>
      <div className="grid grid-cols-2 gap-px">
        {OPTIONS.map(({ theme: option, label, Icon }) => {
          const pressed = theme === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={pressed}
              onClick={() => choose(option)}
              className={cn(
                'flex min-h-11 items-center justify-center gap-2 border text-sm font-medium focus-visible:outline-none focus-visible:ring-2',
                variant === 'sidebar'
                  ? cn(
                      'focus-visible:ring-sidebar-foreground',
                      pressed
                        ? 'border-sidebar-foreground bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'border-sidebar-border text-sidebar-muted hover:text-sidebar-foreground',
                    )
                  : cn(
                      'focus-visible:ring-ring',
                      pressed ? 'border-primary bg-card text-primary' : 'border-border bg-card text-foreground hover:bg-secondary/60',
                    ),
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
