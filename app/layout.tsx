import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import localFont from 'next/font/local';
import { PwaRegister } from '@/components/pwa/pwa-register';
import { THEME_COOKIE, THEME_COLOR, resolveTheme } from '@/components/nav/theme';
import './globals.css';

/**
 * Tipografia do mundo Carnê de Prestações, servida do PRÓPRIO projeto (`app/fonts`, IBM Plex, licença
 * OFL): nenhum pedido a terceiros em tempo de execução.
 *
 * - `--font-ui`: IBM Plex Sans (variável, pesos 100 a 700), a face de trabalho de toda a interface.
 * - `--font-numeral`: IBM Plex Sans Condensed, para valores e numeração de parcela (03/10). É a MESMA
 *   face em todas as escalas, do número do placar ao da célula (classe `.num` / `.tabular`).
 */
const uiFont = localFont({
  src: './fonts/plex-sans-variable.woff2',
  weight: '100 700',
  variable: '--font-ui',
  display: 'swap',
});

const numeralFont = localFont({
  src: [
    { path: './fonts/plex-sans-condensed-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/plex-sans-condensed-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-numeral',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'APPFIN',
  description: 'Controle financeiro domestico',
  // PWA (T-403): instalavel no celular, leitura offline do ultimo estado carregado.
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'APPFIN', statusBarStyle: 'default' },
};

/**
 * Viewport por pedido (lê o cookie de tema): a barra do navegador acompanha a mesa (escuro, o
 * padrão) ou o papel (claro, por escolha da pessoa).
 */
export async function generateViewport(): Promise<Viewport> {
  const theme = resolveTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: 'device-width',
    initialScale: 1,
    // Ocupa a tela inteira do iPhone (inclusive a faixa do indicador de início), para o
    // BottomNav poder somar `env(safe-area-inset-bottom)`: sem `cover` o env() vale 0.
    viewportFit: 'cover',
    themeColor: THEME_COLOR[theme],
    colorScheme: theme,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // O tema vem do cookie, lido no servidor: a página já chega no tema certo, sem piscar.
  const theme = resolveTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="pt-BR" data-theme={theme} className={`${uiFont.variable} ${numeralFont.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
