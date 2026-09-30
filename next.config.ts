import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // O `pdfjs-dist` carrega `pdf.worker.mjs` por import dinamico em tempo de
  // execucao. Empacotado pelo webpack do servidor, esse import aponta para
  // `.next/server/vendor-chunks/pdf.worker.mjs`, que o bundle nao emite, e
  // toda importacao de PDF morre com "Setting up fake worker failed".
  // Mantido externo, o pacote e exigido direto de `node_modules` e o worker
  // resolve. Os testes nunca pegaram isso porque o Vitest nao empacota.
  serverExternalPackages: ['pdfjs-dist'],
  // Erro de tipo ou de lint nao passa no build (CONVENTIONS §6).
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
