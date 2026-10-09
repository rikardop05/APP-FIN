/**
 * Tema do app: ESCURO é o padrão para todos (decisão do Ricardo, 2026-10-09), independente do
 * sistema; o claro só entra por escolha da pessoa. A escolha vive num cookie que o servidor lê
 * (`app/layout.tsx`), então a página já chega no tema certo, sem piscar.
 */

export type Theme = 'dark' | 'light';

export const THEME_COOKIE = 'theme';

/** Cor da barra do navegador por tema (a mesa no escuro, o papel no claro). */
export const THEME_COLOR: Record<Theme, string> = {
  dark: '#0A1010',
  light: '#F1F6F4',
};

/** Qualquer valor que não seja `light` é o padrão: escuro. */
export function resolveTheme(value: string | undefined | null): Theme {
  return value === 'light' ? 'light' : 'dark';
}

/** Valor do cookie para `document.cookie`: um ano, no site todo. */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
}
