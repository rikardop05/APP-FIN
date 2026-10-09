---
name: APPFIN
description: Controle financeiro doméstico desenhado como um carnê de prestações.
colors:
  paper: "hsl(156 22% 95%)"
  ink: "hsl(180 47% 11%)"
  stub-paper: "hsl(156 30% 98%)"
  carne-green: "hsl(168 52% 32%)"
  band: "hsl(156 16% 90%)"
  band-deep: "hsl(156 18% 87%)"
  faded-ink: "hsl(180 15% 34%)"
  stamp-red: "hsl(4 65% 46%)"
  stamp-red-soft: "hsl(4 60% 94%)"
  confere-green: "hsl(158 55% 24%)"
  confere-green-soft: "hsl(156 40% 90%)"
  caution-amber: "hsl(34 88% 26%)"
  caution-amber-soft: "hsl(42 92% 90%)"
  rule: "hsl(160 12% 76%)"
  field-edge: "hsl(165 10% 52%)"
  spine-muted: "hsl(160 14% 72%)"
  spine-rule: "hsl(180 25% 24%)"
typography:
  display:
    fontFamily: "IBM Plex Sans, system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: "2.5rem"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
  body:
    fontFamily: "IBM Plex Sans, system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    fontFeature: "'kern' 1, 'liga' 1"
  label:
    fontFamily: "IBM Plex Sans, system-ui, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
  numeral:
    fontFamily: "IBM Plex Sans Condensed, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: "1.5rem"
    letterSpacing: "0.01em"
    fontFeature: "tabular-nums lining-nums"
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  panel: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.carne-green}"
    textColor: "{colors.stub-paper}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "hsl(168 52% 32% / 0.9)"
  button-outline:
    backgroundColor: "{colors.stub-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.band}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  button-ghost:
    textColor: "{colors.faded-ink}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  button-destructive:
    backgroundColor: "{colors.stamp-red}"
    textColor: "{colors.stub-paper}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "44px"
  input:
    backgroundColor: "{colors.stub-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "44px"
  canhoto:
    backgroundColor: "{colors.stub-paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
  canhoto-preso:
    backgroundColor: "{colors.stub-paper}"
    textColor: "{colors.faded-ink}"
    rounded: "{rounded.none}"
  selo-danger:
    backgroundColor: "{colors.stamp-red-soft}"
    textColor: "{colors.stamp-red}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  selo-attention:
    backgroundColor: "{colors.caution-amber-soft}"
    textColor: "{colors.caution-amber}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  placar:
    backgroundColor: "{colors.stub-paper}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral}"
    rounded: "{rounded.none}"
  nav-spine:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.spine-muted}"
    width: "240px"
  nav-spine-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
---

# Design System: APPFIN

## Overview

**Creative North Star: "O Carnê de Prestações"**

O futuro comprometido é um carnê. Cada lançamento é um canhoto, cada parcela futura é um canhoto ainda preso, e a interface inteira é papel de carnê: uma mesa de tinta verde-escura com o canhoto em papel um pouco mais claro sobre ela (tema ESCURO, o padrão), ou, por escolha da pessoa, papel verde-água muito claro sobre tinta quase preta (tema claro); réguas de 1px e cantos retos. O mundo foi construído primeiro na revisão da fatura (Importar) e cobre todas as telas autenticadas: Painel, Lançamentos, Cartões, Fluxo, Orçamento, Metas, Investimentos e Config.

A densidade é de documento de trabalho, não de app de banco: linhas de 44px, texto corrido em 14px, rótulos em 12px, valores em numerais condensados tabulares que alinham em coluna. A identidade mora em poucos lugares e é impressa, não iluminada: o guilhochê (fundo de segurança) só nas áreas de identidade, o picote tracejado entre canhoto e corpo, e o carimbo de moldura dupla para CONFERE e DIVERGE. O vermelho é tinta de carimbo e nunca marca despesa; a direção do dinheiro vem do sinal.

O tema ESCURO é o padrão para todos, independente do sistema (decisão do Ricardo, 2026-10-09). O claro só entra por escolha da pessoa, no seletor Escuro / Claro da lombada e do painel Mais. A escolha vai para o cookie `theme`, lido no servidor em `app/layout.tsx`, que escreve `data-theme` no `<html>`: a página já chega no tema certo, sem piscar. Os mesmos tokens trocam de valor; não há variantes `dark:`. O contraste de texto (4,5:1 ou mais) é verificado por teste em `components/ui-kit/tokens.test.ts`. A interface rejeita a cara de fintech (roxo, neon, cartão brilhante) e a de ERP frio.

**Key Characteristics:**
- Papel verde-água, tinta verde-escura, um verde-carnê de identidade; vermelho só como carimbo.
- Cantos retos em tudo (raio 0, inclusive `full`).
- Réguas de 1px; régua de tinta de 2px para totais e cabeçalhos de tabela.
- Picote tracejado (1px, 6px de traço, 4px de vão) separa canhotos e fecha cabeçalhos de página.
- Uma face de trabalho (IBM Plex Sans) e uma face de numerais (IBM Plex Sans Condensed) para todo valor.
- Estado nunca só por cor: selo com letra, badge com ícone, faixa com ícone.
- Um único movimento de assinatura: "destacar" os canhotos ao confirmar o lote.

## Colors

Papel de carnê esverdeado e tinta quase preta, com um verde de identidade e três cores de estado que só aparecem quando há estado.

### Primary
- **Verde-Carnê** (carne-green): botão primário, foco (`ring`), seleção de texto a 25%, cursor e `accent-color` dos campos, indicador ativo da barra inferior, traço do guilhochê. No escuro clareia para um verde-água luminoso.

### Neutral
- **Papel de Carnê** (paper): a mesa, fundo de toda tela; também o item ativo da lombada.
- **Papel do Canhoto** (stub-paper): superfícies que se apoiam na mesa (canhotos, campos, placar, blocos de dado); um passo mais claro que a mesa. Também o texto sobre verde-carnê e sobre carimbo vermelho.
- **Tinta** (ink): texto, régua de 2px de totais, e a lombada (navegação lateral) inteira.
- **Tinta Atenuada** (faded-ink): descrições, rótulos de dado, canhotos presos, botão fantasma. 5:1 sobre o papel.
- **Faixa** (band) e **Faixa Funda** (band-deep): fundo de apoio, hover (a 60%), badge neutro, base do guilhochê, faixa informativa.
- **Régua** (rule): a borda padrão de 1px de todo elemento.
- **Borda de Campo** (field-edge): contorno de input/select/botão outline (3:1 sobre o papel), cor do picote, borda tracejada de canhoto preso e de estado vazio, polegar da barra de rolagem.
- **Lombada Atenuada** (spine-muted) e **Régua da Lombada** (spine-rule): itens inativos e divisórias da navegação lateral sobre a tinta.

### Estados
- **Vermelho de Carimbo** (stamp-red, fundo stamp-red-soft): perigo, erro, divergência do lote, linha inválida. Único vermelho do mundo.
- **Verde Confere** (confere-green, fundo confere-green-soft): diferença zerada, PAGO, CONFERE, sucesso.
- **Âmbar de Conferência** (caution-amber, fundo caution-amber-soft): linha que pede atenção (duplicada, baixa confiança, pagamento de fatura).

### Named Rules
**The Carimbo Rule.** Vermelho é tinta de carimbo: só perigo, erro e divergência. Despesa nunca é vermelha; a direção do valor vem do sinal (`Money` com `sign="auto"`).

**The Token, Not Palette Rule.** Tela nova usa os tokens (`text-destructive`, `bg-warning-soft`, `border-success/50`). A paleta crua `red`/`amber`/`emerald` do Tailwind está remapeada para esses tokens (50 a 200 = tom suave, 300 a 400 = tom a 50%, 500 a 950 = tom pleno) só como rede de segurança para telas anteriores ao redesenho; qualquer outra cor crua do Tailwind fica fora do mundo.

**The Soft Ground, Ink Text Rule.** Em faixas e selos de estado, o fundo é o tom suave e a borda é o tom; o texto corrido de uma faixa fica na tinta, e a cor só reforça.

## Typography

**Display/Body Font:** IBM Plex Sans, variável 100 a 700 (com system-ui, Segoe UI, Helvetica Neue, Arial)
**Numeral Font:** IBM Plex Sans Condensed 500 e 600 (com Arial Narrow, Roboto Condensed)

**Character:** Uma face de trabalho, técnica e calma, para toda a interface, e a sua versão condensada só para números: valores, numeração de parcela (03/10) e totais do placar. As duas são servidas do próprio projeto (`app/fonts`, licença OFL), sem pedido a terceiros.

### Hierarchy
- **Display** (600, 36px, 40px): o número-manchete do Painel (headline, comprometido). Raro.
- **Headline** (600, 28px, 32px, tracking apertado): título de página (`PageHeader`) e nome do banco na capa do lote.
- **Title** (600, 16px a 18px): título de seção e de coluna lateral ("Ainda presos"); 22px (`text-xl`) para veredito de tela.
- **Body** (400, 14px, 20px): texto de trabalho de toda tela, descrições, linhas. Campos sobem para 16px no celular (evita zoom do iOS) e voltam a 14px a partir de `sm`.
- **Label** (500, 12px, 16px): rótulo de dado (`dt`), selo, badge, aba da barra inferior. Cabeçalho de tabela usa o label em caixa alta com tracking leve, sobre a régua de tinta.
- **Numeral** (Plex Sans Condensed 500, tabular e lining, +0,01em): todo valor, em qualquer tamanho; 600 nos totais do placar (16px, 18px a partir de `sm`).

### Named Rules
**The One Numeral Face Rule.** Todo valor monetário passa por `Money` e todo número de parcela por `Parcela`; os dois usam a classe `.num`. É a mesma face do placar à célula, sempre tabular, para alinhar em coluna.

**The 12px Floor Rule.** A escala começa em 12px (`text-xs`). Nenhum rótulo de 10 ou 11px, nem tamanho arbitrário.

## Layout

Shell de duas peças. A partir de `md` (768px), a lombada fixa de 240px à esquerda (altura da janela, rola por dentro) e o conteúdo num `main` centrado de no máximo 1152px (`max-w-6xl`), com 24px de folga lateral (16px no celular) e 24px no topo. Abaixo de `md`, a barra inferior fixa substitui a lombada; o `main` reserva por baixo a altura dela mais 32px.

A área segura do iPhone é parte do layout: `viewport-fit=cover`, a variável `--bottom-nav-h` (64px mais `safe-area-inset-bottom`) é somada pela barra inferior, pelo painel "Mais" e por todo rodapé fixo (`Placar` com `position="sticky"`), e as laterais usam `max(margem, env(safe-area-inset-*))`.

Ritmo: 4px entre rótulo e valor, 8px e 12px dentro de componentes e entre linhas, 16px entre blocos, 20px de padding de painel no desktop (16px no celular), 24px entre seções da página. Os alvos de toque têm 44px no celular e compactam para 36px (32px no tamanho pequeno) a partir de `sm`.

Grades de dados usam `gap-px` sobre fundo de régua para desenhar divisórias de 1px sem bordas duplas (capa do lote); o placar divide colunas com `divide-x` na régua.

## Elevation & Depth

O mundo é papel plano. A profundidade vem de tom (papel do canhoto mais claro que a mesa), de réguas de 1px, da régua de tinta de 2px que fecha totais e cabeçalhos, e do picote. `shadow-sm` e `shadow` resolvem para nada; os cartões não flutuam.

### Shadow Vocabulary
- **Régua inferior** (`box-shadow: 0 1px 0 hsl(var(--border))`, `shadow-md`): uma régua de 1px desenhada como sombra, quando a borda não serve.
- **Folha solta** (`box-shadow: 0 0 0 1px hsl(var(--foreground) / 0.18), 0 10px 24px -10px hsl(var(--foreground) / 0.35)`, `shadow-lg`): só diálogo modal e painel flutuante, a folha que saiu da pilha.

### Named Rules
**The Ruled Paper Rule.** Superfície em repouso não tem sombra. Separação é régua (1px), régua de tinta (2px) ou picote; sombra só para o que flutua acima da página.

**The Guilhoché Rule.** O fundo de segurança (ondas de 56 por 28px, traço de 0,8px pintado pelo token `primary` por máscara, a 22% de opacidade no claro e 40% no escuro, e 10% / 18% sobre a tinta) aparece só em área de identidade: capa do lote, bloco de título do placar, marca da lombada. Nunca atrás de número ou texto corrido; o que se escreve sobre ele ganha uma tarja sólida de papel do canhoto.

## Shapes

Cantos retos em todo o mundo: `--radius` é 0 e toda a escala `rounded` do Tailwind, inclusive `full`, está zerada na configuração. Nada de pílula nem cartão arredondado.

A forma é a do carnê: caixas de 1px, a régua de tinta de 2px no topo do placar e sob o cabeçalho de tabela, e o picote, um tracejado de 1px (6px de traço, 4px de vão) na cor de borda de campo, horizontal entre blocos e vertical entre o canhoto e o corpo da linha. Borda tracejada significa "ainda não": canhoto preso (parcela futura) e estado vazio. O carimbo é a única forma inclinada (-3°), de moldura dupla.

## Components

### Buttons
Retângulos de régua, sem pílula, sem sombra.
- **Shape:** cantos retos (0), borda de 1px sempre presente (transparente nas variantes sem contorno), para todas as variantes terem a mesma caixa.
- **Primary:** verde-carnê com texto papel do canhoto, 500, 14px. **Bloqueado** (`disabled` ou `aria-disabled`): papel apagado (faixa `secondary`, borda de campo, texto atenuado), nunca o verde esmaecido, para o pronto e o bloqueado diferirem nos dois temas; 44px de altura no celular e 36px a partir de `sm`, 16px de padding lateral. Tamanho `sm`: 12px, 12px de padding, 32px a partir de `sm`.
- **Hover / Focus:** hover clareia o fundo a 90%; foco é anel de 2px no verde-carnê com 2px de afastamento sobre a mesa. Desabilitado a 50%.
- **Outline:** papel do canhoto com borda de campo, texto tinta; hover em faixa a 60%.
- **Secondary:** faixa com texto tinta. **Ghost:** sem fundo, tinta atenuada, hover em faixa a 60% com texto tinta. **Destructive:** carimbo vermelho cheio, só para ação perigosa.

### Badge e Selo
- **Badge:** etiqueta quadrada de 12px com borda no tom a 50%, fundo suave e ícone (check, alerta, X) nos estados; neutro em faixa com régua.
- **Selo:** o estado de linha. Um quadradinho de 20px com a LETRA do estado (cheio no tom) colado ao texto por extenso, em moldura no tom. Tons: neutro (tinta), confere, atenção, perigo. Só `danger` usa vermelho. **Uma letra por estado no app todo**, da tabela única `ESTADO_LETRA` (`components/ui-kit/carne.ts`); quem usa o Selo passa só o rótulo e o tom, nunca a letra. O teste exige que a tabela não repita letra e que todo rótulo em uso esteja nela.

  | Letra | Estado | Letra | Estado |
  |---|---|---|---|
  | A | Saldo negativo | N | Não paga |
  | B | Baixa confiança | O | Confirmado |
  | C | Não categorizado | P | Previsto |
  | D | Duplicada | R | Aberta |
  | E | Divergência | S | Sem saldo negativo |
  | F | Informativa | T | Pendente |
  | G | Pagamento | U | Vencimento desatualizado |
  | H | Desfeito | V | Vencida, não marcada como paga |
  | I | Incompleta | Z | Paga |
  | K | Falhou | M | Fechada |
  | Y | Dentro do limite | L | Perto do limite |
  | X | Estourou | Q | Sem limite |
  | W | Depende das faturas | | |

### Carimbo (signature)
Moldura dupla (borda de 2px mais contorno de 1px afastado 2px), texto de 12px em caixa alta, 600, tracking largo, girado -3°. Verde confere para PAGO/CONFERE, vermelho de carimbo para DIVERGE. Reservado a esse veredito.

### Canhoto (signature)
A linha de lançamento ou parcela. Grade de quatro colunas: canhoto de 68px (numeral; ver a regra do talão abaixo), picote vertical, corpo (descrição e selos), valor à direita em numeral. No celular o valor desce para baixo do corpo e a linha mantém 44px ou mais. Papel do canhoto com régua de 1px; régua âmbar quando pede atenção, vermelha quando há perigo. O editor da linha abre como faixa abaixo, depois de um picote horizontal. **Preso** (parcela futura): borda tracejada na cor de campo e texto atenuado.

**Regra do talão.** O talão significa UMA coisa por linha. **Parcela n/N** (`Parcela`, `parcelaLabel`): `03/10`, dois dígitos, COM barra, só para parcela. **Data** (`dataTalao`): `04 out`, dia de dois dígitos, mês de três letras minúsculas em pt-BR, SEM barra, sem ponto e sem ano (o ano vem do título ou do cabeçalho). `04/10` nunca aparece num talão, porque se confunde com parcela. A fatura de cartão não é parcela: seu talão é o vencimento (`20 jul`). Os dois helpers estão em `components/ui-kit`. Linha parcelada mostra a parcela no talão; a data completa fica no corpo. O "(03/10)" que o banco imprime na descrição sai quando o talão já o mostra (`stripInstallmentSuffix`).

**Seleção.** O próprio talão é o controle de seleção para edição em lote (botão com `aria-pressed`): a seleção NÃO usa caixinha (a linha já tem o checkbox "Incluir", e dois quadrados confundem): aparece só pelo preenchimento verde do talão, pelo contorno verde-carnê do canhoto e por um visto simples e reto na cor primária, sem moldura, que surge apenas quando selecionado (a forma inclinada é só do carimbo de veredito: PAGO, CONFERE, DIVERGE); hover e pressionado a 10% e 25% de verde-carnê, com contorno discreto no hover. O texto da interface diz "canhoto" ("Clique no canhoto" com mouse, "Toque no canhoto" em toque), nunca "talão". O checkbox da linha fica só para "Incluir", que é outra decisão.

**Mês no talão (Fluxo).** Uma coluna de canhotos para os 12 meses: o talão traz o mês abreviado e o ano em duas linhas (`out` / `2026`), sem barra, porque um mês não é parcela nem data; o saldo de fechamento é o valor, entradas e saídas ficam no corpo, e o mês futuro que já carrega fatura ou parcela é um canhoto PRESO (tracejado). A curva do saldo fica abaixo, em segundo plano.

**Meta como carnê (Metas).** O que já foi guardado é um carimbo "Guardado" com o total (a meta não guarda aportes individuais); os aportes que faltam são canhotos presos numerados `01/12` (`Parcela`), um por mês até a data-alvo, com o valor mensal. Os primeiros quatro ficam à vista; o resto atrás de "Ver os outros".

**Agrupamento por mês (Lançamentos).** A lista agrupa por competência com um cabeçalho de régua de tinta de 2px: o mês por extenso, a contagem e o total líquido do mês. J e K pulam entre as linhas.

**Divergência pede atrito, não bloqueio.** Com o placar em DIVERGE, "Confirmar" continua permitido, mas vira contorno com o valor da diferença no rótulo ("Confirmar com diferença de R$ 30,00"), e a ação primária passa a ser "Mostrar o que pode faltar" (filtra as linhas excluídas, duplicadas e de baixa confiança). Em CONFERE nada muda. **Veredito que depende de fatura (Fluxo, igual ao Painel):** quando a projeção principal não fica negativa mas a leitura com as faturas anteriores não pagas ficaria, o veredito vira atenção (selo "Depende das faturas", letra W, tom atenção, nunca vermelho), diz em que mês fica negativo e leva a "Já paguei: marcar em Cartões".

### Placar (signature)
Rodapé de totais (Total da fatura, Incluído, Diferença) com régua de tinta de 2px no topo, papel do canhoto, colunas divididas por régua. Bloco de título à esquerda sobre guilhochê, rótulo de 12px em caixa alta numa tarja sólida. Valores em numeral 600; a Diferença em verde confere quando zera e vermelho de carimbo quando diverge. Versão fixa acima da barra inferior no celular, no rodapé no desktop. No celular o placar **fecha numa linha** (o item principal, a Diferença, mais a ação) e abre no toque do botão de seta (`aria-expanded`), mostrando todos os totais; a partir de `sm` é sempre aberto.

### Faixa
Aviso em bloco: régua de 1px no tom (a 60%), fundo suave, ícone de 16px no tom, texto na tinta. Tons info, ok, atenção, perigo.

**Faixa de não categorizados (Orçamento).** O orçamento é por subcategoria, então despesa sem categoria não entra em nenhuma barra. Quando há, uma Faixa de atenção abre a tela: "N lançamentos sem categoria (R$ X) não entram no orçamento. Revisar", com o verbo no plural certo e o link para `/lancamentos/revisar`. O valor é a saída líquida da competência mostrada (estorno abate, piso em zero). Sem lançamento sem categoria, a faixa não aparece.

### Inputs / Fields
- **Style:** papel do canhoto, borda de 1px na cor de campo, cantos retos, 12px de padding lateral, 44px de altura (36px a partir de `sm`), 16px de texto no celular e 14px no desktop. Select idêntico ao input; checkbox nativo de 20px com `accent-color` verde-carnê.
- **Focus:** anel de 2px no verde-carnê.
- **Error / Disabled:** `aria-invalid` troca a borda para o vermelho de carimbo; desabilitado a 50% com cursor bloqueado.
- **DateField:** data em pt-BR, digita-se `dd/mm/aaaa` (as barras entram sozinhas, teclado numérico), o valor sai em ISO; no lugar do `<input type="date">` nativo, que mostra "dd/mm/yyyy" no idioma do navegador. Data incompleta ou inexistente marca `aria-invalid`.
- **DateField em uso.** Todo campo de data das telas usa `DateField`, nunca `<input type="date">`: Recorrentes (início e fim), conta (data do saldo inicial) e filtros de Lançamentos (de e até). Campo opcional recebe `''` quando a data está incompleta e a tela grava `null`; campo obrigatório deixa o erro de validação dizer que falta data.
- **MonthPicker:** seletor de competência em pt-BR, mês e ano lado a lado (`1fr` e 96px), construído com os mesmos campos.

### Cabeçalho de Página e Tabela
`PageHeader`: título headline, descrição em tinta atenuada, ações à direita, fechado por um picote. `DataTable`: cabeçalho em label de caixa alta sobre régua de tinta de 2px, ordenação por coluna com seta, paginação no cliente. `EmptyState`: caixa tracejada na cor de campo, ícone de 40px atenuado, título, uma ação primária obrigatória.

### Navigation
- **Lombada (desktop, a partir de `md`):** coluna de 240px em tinta, presa à altura da janela. Topo com a marca APPFIN (18px, 600, tracking largo) sobre guilhochê claro. Itens de 44px, 14px 500, ícone de 16px, inativo em lombada atenuada com hover a 10% de papel; ativo só pelo preenchimento (papel com texto tinta), sem faixa lateral. No rodapé, o seletor de tema (Escuro / Claro) e o Sair fixo.
- **Barra inferior (celular):** fixa, papel da mesa com régua de topo, altura `--bottom-nav-h`. Quatro abas diretas (Painel, Lançamentos, Cartões, Fluxo) mais "Mais"; aba de 44px ou mais, ícone de 20px, rótulo de 12px. Ativo em verde-carnê com uma régua de 2px no topo da aba.
- **Painel "Mais":** navegação revelada (não menu), sobre véu de tinta a 30%, régua de tinta de 2px no topo, picote sob o título, grade de três blocos com régua; ativo com borda e texto verde-carnê. Fecha com Escape e devolve o foco.

### Motion
Transições de cor curtas nos estados. Um único movimento de assinatura, "destacar": ao confirmar o lote, o canhoto e o picote de cada linha recuam 10px e voltam (420ms, ease-out) e a linha assenta 3px para baixo a 55% de opacidade (280ms, ease-in, depois dos 420ms), com 18ms de defasagem por linha. Com `prefers-reduced-motion`, nada se move e ninguém espera.

## Do's and Don'ts

### Do:
- **Do** passar todo valor por `Money` e toda numeração por `Parcela`, para que caiam na face condensada tabular.
- **Do** separar canhoto e corpo com o picote vertical e blocos empilhados com o picote horizontal.
- **Do** sinalizar estado com letra (Selo) ou ícone (Badge, Faixa) além da cor.
- **Do** usar borda tracejada na cor de campo para o que ainda não aconteceu (parcela presa) e para o vazio.
- **Do** fechar totais e cabeçalhos de tabela com a régua de tinta de 2px.
- **Do** somar `--bottom-nav-h` em todo elemento fixo ao pé da tela no celular.
- **Do** manter 44px de alvo de toque no celular.

### Don't:
- **Don't** pintar despesa de vermelho; vermelho é carimbo de perigo, erro e divergência.
- **Don't** pôr número ou texto corrido sobre o guilhochê sem tarja sólida, nem usar o guilhochê fora das áreas de identidade.
- **Don't** arredondar cantos nem usar pílula.
- **Don't** dar sombra a cartão ou painel em repouso; sombra é só da folha que flutua (diálogo).
- **Don't** usar cores cruas do Tailwind fora da rede de segurança (`sky`, `blue`, `violet` etc.), nem hex solto em componente.
- **Don't** usar texto abaixo de 12px.
- **Don't** usar o carimbo para algo que não seja o veredito PAGO, CONFERE ou DIVERGE.
