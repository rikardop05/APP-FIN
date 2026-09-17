/**
 * Estado do formulario de magic link. Fica **fora** de `actions.ts` porque um
 * arquivo `'use server'` so pode exportar funcoes assincronas — um tipo e uma
 * constante nao sao.
 */
export type MagicLinkState = {
  status: 'idle' | 'sent' | 'denied' | 'error';
};

export const INITIAL_MAGIC_LINK_STATE: MagicLinkState = { status: 'idle' };

/** Texto exibido ao usuario para cada estado, em pt-BR (CONVENTIONS §1). */
export function messageForStatus(state: MagicLinkState): string | null {
  switch (state.status) {
    case 'sent':
      return 'Link enviado. Abra o e-mail neste aparelho para entrar.';
    case 'denied':
      return 'Este endereco nao tem acesso ao APPFIN.';
    case 'error':
      return 'Nao foi possivel enviar o link agora. Tente de novo em instantes.';
    case 'idle':
      return null;
  }
}
