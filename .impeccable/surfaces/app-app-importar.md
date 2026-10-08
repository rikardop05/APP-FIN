---
version: 1
slug: "app-app-importar"
primary_target: "app/(app)/importar"
related_targets: ["components/import"]
---

# Surface brief: Importar e revisão da fatura

Mode: Operate. Primeira superfície do redesenho do APPFIN (mundo novo, substitui o shadcn padrão); o mesmo mundo depois cobre Painel, Lançamentos, Cartões, Fluxo, Orçamento, Metas, Investimentos e Config.

## Job
Fechamento mensal, no desktop, sentado: importar o PDF da fatura (até ~30 linhas), revisar só o que precisa, conferir lote × fatura e confirmar em menos de 2 minutos. Os dois operam igual.

## Anti-metas
Não pode parecer app de banco (fintech, roxo/neon, cartão brilhante, cara de vender crédito). Não pode ficar frio/corporativo (ERP, planilha de empresa).

## Direction contract

THESIS: O futuro comprometido é um carnê. Cada lançamento da fatura é um canhoto; parcelas futuras são os canhotos ainda presos. Recusa o arranjo padrão de "cards de resumo + tabela genérica + formulário por linha".

OWN-WORLD: Papel de carnê em verde-água muito claro com fundo de segurança (guilhoché) só em áreas de identidade (cabeçalho do lote, placar), nunca atrás de números. Tinta verde-escura quase preta para texto, verde-carnê como cor de identidade, vermelho de carimbo reservado a PAGO/divergência/perigo (despesa NÃO é vermelha). Picote tracejado separa canhotos; numeração de canhoto (03/10) em numerais tabulares condensados; uma face de UI de trabalho para o resto. Réguas de 1px, cantos retos.

STORY: Vocês entendem de relance o que entrou na fatura, o que já vem comprometido dos meses seguintes e se o lote bate com o total impresso; corrigem só as linhas sinalizadas e confirmam.

FIRST VIEWPORT (desktop 1440): navegação lateral do app. Cabeçalho do lote como capa do carnê: banco, cartão, competência, vencimento. Abaixo, a lista de canhotos densa, uma linha por lançamento (data · descrição · parcela n/N · categoria · responsável · valor), editor completo só ao abrir uma linha; linhas que precisam de atenção trazem selo e letra, não só cor. À direita, coluna estreita "Ainda presos": as parcelas que este lote projeta nos próximos meses, por competência. Rodapé fixo, o placar: Total da fatura · Incluído · Diferença (carimbo PAGO-verde quando zera, vermelho quando diverge) e Confirmar importação.

FORM: Carnê de Prestações; position 1 on the ordered list (pick card, chosen by the user over the assigned #4 Tabela de Classificação); seed key 92bdf52f.

SIGNATURE: o picote. Confirmar o lote "destaca" os canhotos (o picote se abre e os canhotos assentam no histórico), e em qualquer tela o futuro comprometido aparece como canhotos ainda presos. Movimento único, curto, respeitando prefers-reduced-motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Escopo e limites
- Funcionalidade preservada: confirmação obrigatória, duplicadas desmarcadas, linha de pagamento de fatura sinalizada, texto original nas linhas de baixa confiança, senha de PDF só em memória, desfazer lote.
- Novo: edição em lote (categoria, responsável), filtro "Só o que precisa de atenção", J/K entre linhas sinalizadas, total impresso da fatura visível no placar, pular para a linha inválida, área de soltar arquivo em pt-BR.
- Volume: 1 a ~30 linhas por fatura; vazio e erro de leitura de PDF precisam de estado.
- Code-led (sem geração de imagem). Next 15, Tailwind 3; pode trocar tokens e componentes do ui-kit.

## Decisões em aberto
Nomes e definições dos números (Sobra, Comprometido, Aportes): ver .impeccable/clarify/2026-10-08-numeros-entre-telas.md, decisão do Ricardo.
