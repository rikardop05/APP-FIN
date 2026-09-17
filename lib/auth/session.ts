import { toAppSession } from './app-session';
import { auth } from './index';

import type { AppSession } from './app-session';

export type { AppSession } from './app-session';
export { toAppSession } from './app-session';

/**
 * Erro tipado de "sem sessao". Existe para os consumidores testarem o **tipo**,
 * nunca o texto da mensagem.
 *
 * Motivo: `requireSession` e chamado por rotas que precisam distinguir "sem
 * sessao" (401) de erro inesperado (500). Se a distincao fosse por
 * `error.message.startsWith(...)`, a mensagem viraria API publica — reformular,
 * traduzir ou tirar o acento quebraria as rotas **em silencio**, sem erro de
 * compilacao e sem teste vermelho. Com a classe, o `instanceof` e a unica coisa
 * acoplada, e a mensagem fica livre para mudar.
 *
 * Uso nas rotas: `if (error instanceof SessionMissingError) return 401`.
 */
export class SessionMissingError extends Error {
  constructor(message = 'Sessao ausente: rota deveria estar protegida pelo middleware.') {
    super(message);
    this.name = 'SessionMissingError';
  }
}

/**
 * Helper unico de sessao (BUILD-PLAN T-004): resolve `householdId` e `memberId`
 * da sessao. E o **unico** lugar que o resto do app consulta para saber quem
 * esta logado — duas resolucoes divergentes seriam o mesmo buraco de seguranca
 * que duas allowlists.
 *
 * Nao vai ao banco: os dois ids estao no token, gravados no login.
 */
export async function getSession(): Promise<AppSession | null> {
  return toAppSession(await auth());
}

/**
 * Como `getSession`, mas **lanca** quando nao ha sessao. Para rotas de API: o
 * middleware ja barra a navegacao, e aqui a ausencia de sessao e um erro de
 * programacao (ou acesso direto indevido), nao um caminho normal.
 *
 * Lanca `SessionMissingError` — nunca um `Error` cru (ver a classe acima).
 */
export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) {
    throw new SessionMissingError();
  }
  return session;
}
