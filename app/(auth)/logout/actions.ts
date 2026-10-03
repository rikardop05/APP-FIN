'use server';

import { signOut } from '@/lib/auth';
import { LOGIN_PATH } from '@/lib/auth/route-access';

/**
 * Sair da conta (T-403, decisao 4): encerra a sessao do Auth.js e leva para o login. O cache
 * offline do aparelho e apagado ANTES, pelo botao (`clearOfflineCache`), e de novo pelo service
 * worker se ele ainda ve o pedido de saida ou a sessao acabada.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: LOGIN_PATH });
}
