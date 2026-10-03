import type { Metadata, Viewport } from 'next';
import { PwaRegister } from '@/components/pwa/pwa-register';
import './globals.css';

export const metadata: Metadata = {
  title: 'APPFIN',
  description: 'Controle financeiro domestico',
  // PWA (T-403): instalavel no celular, leitura offline do ultimo estado carregado.
  manifest: '/manifest.webmanifest',
  icons: { apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'APPFIN', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#18181b',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
