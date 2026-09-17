import { describe, expect, it } from 'vitest';

import { authConfig } from './config';

/**
 * A configuracao que o `middleware.ts` usa roda em runtime de **borda**, sem
 * cliente Postgres. O Auth.js recusa um provider de e-mail sem adapter
 * (`MissingAdapter`); por isso o provider mora em `lib/auth/index.ts` (Node) e
 * aqui so ha callbacks. Este teste trava essa separacao — se alguem mover o
 * provider para ca, o middleware quebra em producao e o teste avisa antes.
 *
 * Nao instancia o `NextAuth` aqui: o runtime dele nao carrega sob o resolvedor
 * do Vitest (importa `next/server` sem extensao, que so o bundler resolve). A
 * prova de que a instancia de borda sobe de verdade fica na validacao com o
 * servidor de dev.
 */
describe('authConfig (instancia de borda do middleware)', () => {
  it('nao declara provider de e-mail — sem MissingAdapter na borda', () => {
    expect(authConfig.providers).toHaveLength(0);
  });

  it('usa sessao em cookie JWT', () => {
    expect(authConfig.session?.strategy).toBe('jwt');
  });

  it('aponta as telas de auth para /login', () => {
    expect(authConfig.pages?.signIn).toBe('/login');
  });
});
