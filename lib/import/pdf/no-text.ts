/**
 * PDF sem camada de texto — o arquivo abre, mas não há nada para ler.
 *
 * Acontece quando a fatura vira imagem: foto ou captura de tela salva como PDF, ou "Imprimir como PDF"
 * (Microsoft Print to PDF) sobre uma página já rasterizada. Medido num PDF de fatura do Inter nessas
 * condições: 6 páginas, 6 imagens, 0 fontes. Não há como o parser ler isso, e OCR está fora de escopo
 * (IMPORT-SOURCES §3): converter imagem em texto é tarefa de quem envia, por fora do app.
 *
 * Antes, esse arquivo caía em "Não foi possível reconhecer o banco neste PDF", que culpa o emissor e
 * manda conferir cartão e senha. A causa real é outra e a saída também: baixar o PDF original do banco.
 *
 * Mensagem e dica vivem aqui porque a rota (que decide) e a tela (que escolhe a dica) as compartilham.
 *
 * Modulo puro (CONVENTIONS §5).
 */

/** O que a rota responde quando o PDF não tem texto. */
export const NO_TEXT_LAYER_MESSAGE =
  'Este PDF não tem texto para ler: parece uma imagem, como uma captura de tela ou uma foto salva em PDF.';

/** O que fazer, no lugar da dica genérica de "confira cartão, competência e senha". */
export const NO_TEXT_LAYER_HINT =
  'Baixe a fatura original no app ou no site do banco, sem imprimir nem tirar print: o arquivo certo permite selecionar o texto com o mouse. Também dá para colar o texto da fatura mais abaixo.';

/** Dica sob o erro de leitura: a específica do PDF sem texto, ou a genérica dos demais casos. */
export function readFailureHint(message: string | null, genericHint: string): string {
  return message === NO_TEXT_LAYER_MESSAGE ? NO_TEXT_LAYER_HINT : genericHint;
}
