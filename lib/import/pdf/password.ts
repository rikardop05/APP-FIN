/**
 * Senha de PDF no upload — o que a rota e a tela combinam entre si.
 *
 * O campo de senha existia, mas só aparecia quando `detectSource` achava o marcador `/Encrypt` nos bytes.
 * Se a detecção não pegasse, ou se a senha digitada estivesse errada e o campo tivesse sumido, a pessoa
 * via "Informe a senha" sem ter onde informar. Agora:
 *
 * 1. A rota marca o erro de senha com `PDF_PASSWORD_ERROR_CODE`, para a tela não adivinhar pelo texto.
 * 2. A tela mostra o campo já aberto quando o PDF é detectado como protegido OU o servidor pediu senha.
 * 3. Em qualquer outro PDF o campo continua à mão, recolhido, em "Este PDF tem senha?".
 *
 * A senha vive só na memória da tela e vai no corpo do upload; nunca em log, mensagem nem retorno
 * (RF-IMP-11). Nada disto toca a senha em si.
 *
 * Modulo puro (CONVENTIONS §5).
 */

/** Campo `code` do corpo de erro da rota quando o PDF pede senha (ausente ou incorreta). */
export const PDF_PASSWORD_ERROR_CODE = 'pdf_password';

/** Rótulo do campo de senha. */
export const PASSWORD_FIELD_LABEL = 'Senha da fatura';

/** Título do recolhível, quando o PDF não foi detectado como protegido. */
export const PASSWORD_OPTIONAL_LABEL = 'Este PDF tem senha?';

/** Dica sob o erro de leitura quando o problema é a senha: aponta onde digitá-la. */
export const PASSWORD_REQUESTED_HINT =
  'Digite a senha no campo “Senha da fatura”, logo abaixo do arquivo, e envie de novo. Ela fica só na memória e não é salva.';

/**
 * O campo de senha deve aparecer já aberto? Sim quando o PDF foi detectado como protegido ou quando o
 * servidor acabou de pedir a senha; senão fica recolhido, mas disponível.
 */
export function isPasswordFieldOpen(input: { encrypted: boolean; requested: boolean }): boolean {
  return input.encrypted || input.requested;
}

/** `true` quando o corpo de erro da rota diz que a falha foi de senha. */
export function isPasswordErrorCode(code: unknown): boolean {
  return code === PDF_PASSWORD_ERROR_CODE;
}
