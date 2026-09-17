/**
 * Allowlist de acesso — fonte unica de verdade (RNF-01).
 *
 * O household tem **exatamente 2 membros** e nao existe cadastro, convite nem
 * auto-registro: quem nao estiver nesta lista nao entra. Este modulo e o unico
 * lugar do projeto que le `AUTH_ALLOWED_EMAILS`; seed, login e qualquer outra
 * borda consomem daqui. Duas leituras divergentes da mesma allowlist seriam um
 * buraco de seguranca (uma delas aceitaria o que a outra recusa).
 *
 * Sem dependencia de runtime Node/Next: so `process.env`, para poder ser
 * importado tanto pelo seed (Node puro) quanto pelo middleware (edge).
 *
 * Privacidade (CONVENTIONS §9): nenhuma funcao daqui devolve, loga ou embute um
 * e-mail em mensagem de erro. Mensagem de erro so carrega contagem.
 */

/** Nome da variavel de ambiente unica da allowlist. */
export const ALLOWED_EMAILS_ENV = 'AUTH_ALLOWED_EMAILS';

/** Quantidade de membros do household — fixa por SPEC §2 e RNF-01. */
export const ALLOWED_EMAILS_COUNT = 2;

/** Normaliza um e-mail para comparacao: trim + minusculas. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Le e valida a allowlist do ambiente. Devolve os 2 e-mails normalizados, na
 * mesma ordem em que aparecem na variavel.
 *
 * **Lanca** quando a configuracao esta errada: o seed deve falhar alto e claro
 * em vez de gravar um household incompleto. Quem precisa de um teste booleano
 * (middleware, login) usa `isAllowedEmail`, que fecha em vez de lancar.
 */
export function readAllowedEmails(): readonly [string, string] {
  const raw = process.env[ALLOWED_EMAILS_ENV] ?? '';
  const emails = raw
    .split(',')
    .map((email) => normalizeEmail(email))
    .filter((email) => email.length > 0);

  if (emails.length !== ALLOWED_EMAILS_COUNT) {
    // Mensagem acionavel: o que falta, quantos vieram e o formato exato. O
    // valor recebido nao entra — so a contagem (CONVENTIONS §9).
    throw new Error(
      `${ALLOWED_EMAILS_ENV} precisa ter exatamente ${ALLOWED_EMAILS_COUNT} e-mails distintos, ` +
        `separados por virgula (os ${ALLOWED_EMAILS_COUNT} membros do household, RNF-01); ` +
        `recebi ${emails.length}. ` +
        `Preencha em .env.local, ex.: ${ALLOWED_EMAILS_ENV}=voce@exemplo.com,outro@exemplo.com`,
    );
  }
  // Os membros precisam ser distintos: `members.email` e unique, entao um
  // e-mail repetido gravaria um membro so e o sistema anunciaria dois.
  if (emails[0] === emails[1]) {
    // Sem ecoar o valor: e-mail e dado pessoal e nao pode trafegar em log.
    throw new Error(
      `${ALLOWED_EMAILS_ENV} tem o mesmo e-mail duas vezes. ` +
        `O household tem ${ALLOWED_EMAILS_COUNT} membros distintos (SPEC §2, multiusuario); ` +
        'corrija a variavel em .env.local.',
    );
  }
  return [emails[0]!, emails[1]!];
}

/**
 * Testa se um e-mail pode entrar. **Fecha em vez de abrir**: variavel ausente,
 * malformada ou com e-mail repetido devolve `false` (nega), nunca lanca. O
 * middleware e a rota de login usam esta funcao para decidir, e um erro de
 * configuracao nunca pode virar acesso liberado.
 */
export function isAllowedEmail(email: string): boolean {
  const candidate = normalizeEmail(email);
  if (candidate.length === 0) return false;

  try {
    return readAllowedEmails().includes(candidate);
  } catch {
    return false;
  }
}
