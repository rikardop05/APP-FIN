import type { Metadata } from 'next';

import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Entrar · APPFIN',
};

/**
 * Unica pagina publica (BUILD-PLAN T-004). O middleware libera `/login` e
 * redireciona todo o resto para ca quando nao ha sessao.
 */
export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          {/* A marca: o mesmo canhoto do favicon (app/icon.svg), pequeno, à esquerda do nome.
              SVG estático de 453 bytes: next/image (otimizador) não é o caminho, é img direto. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" aria-hidden="true" className="h-12 w-12" />
          <h1 className="text-2xl font-semibold text-foreground">APPFIN</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Informe um e-mail autorizado e enviaremos um link de acesso.
        </p>
      </div>

      <LoginForm />
    </main>
  );
}
