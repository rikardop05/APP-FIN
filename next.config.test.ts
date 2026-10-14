import { describe, expect, it } from 'vitest';

import nextConfig from './next.config';

/**
 * Guarda dos cabecalhos de seguranca de producao (docs/DEPLOY.md §7): se
 * alguem remover a secao `headers` do next.config, o deploy segue sem os
 * cabecalhos e ninguem percebe. Sem CSP de proposito (quebraria os scripts
 * inline do Next).
 */
describe('next.config: cabecalhos de seguranca', () => {
  it('envia nosniff, DENY, referrer e permissions em todas as rotas', async () => {
    const routes = await nextConfig.headers?.();
    expect(routes).toHaveLength(1);
    const headers = Object.fromEntries(
      (routes?.[0]?.headers ?? []).map((header) => [header.key, header.value]),
    );
    expect(routes?.[0]?.source).toBe('/:path*');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
  });
});
