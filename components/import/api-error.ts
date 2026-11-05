/**
 * Mensagem de erro de uma resposta da API de importacao. Quando o corpo nao e o
 * JSON `{ error }` esperado (HTML de erro da plataforma, timeout, modulo que
 * quebrou antes do try/catch da rota), inclui o status HTTP para que o proximo
 * diagnostico nao fique cego.
 */
export function describeApiError(
  parsedError: string | null,
  status: number,
  fallback: string,
): string {
  if (parsedError !== null) return parsedError;
  return `${fallback.replace(/\.$/, '')} (erro ${status}).`;
}
