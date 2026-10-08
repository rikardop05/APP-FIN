/**
 * Maximo de linhas por previa e por gravacao de "aplicar regras" (F3). Acima
 * disso, o usuario aplica e repete.
 *
 * Mora sozinho, sem importar `db`: o schema da rota (`app/api/rules/schemas.ts`)
 * precisa dele, e importar `apply-rules.ts` ali puxaria a conexao do banco para
 * todo modulo e teste que so valida corpo de requisicao.
 */
export const APPLY_RULES_LIMIT = 500;
