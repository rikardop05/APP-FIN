# IMPORT-SOURCES — formatos de entrada por banco

> Preenchido em T-100, antes de qualquer parser ser escrito. Um `bank_key` por linha.
> Ordem de preferência técnica: **OFX > CSV > XLS/XLSX > PDF com camada de texto > texto colado**. Sempre usar o formato mais alto disponível — quanto mais alto, menos heurística e menos conserto manual.
>
> **Achado de 2026-09-09: nenhum dos três bancos da família oferece OFX.** Os dois primeiros degraus da escada estão indisponíveis ou adiados, e a v1 opera nos dois últimos.
>
> **Na v1, os caminhos implementados são PDF (camada de texto) e texto colado.** CSV e XLS/XLSX foram adiados por decisão do humano (T-105, T-118), junto com a maquinaria de mapeamento de coluna; OFX foi adiado (T-106) por indisponibilidade nos três bancos.

## 1. Bancos em uso

| bank_key | Instituição | Origem | Formato alvo | Arquivo de exemplo | Status |
|---|---|---|---|---|---|
| `nubank_card` | Nubank | fatura de cartão | **PDF** (v1, T-117) — sem senha | `Nubank_2026-09-09.pdf` | ✓ sonda ok |
| `nubank_account` | Nubank | extrato de conta | sem OFX; CSV/planilha **a confirmar pelo humano** (Fase 4) | — | ⏳ a confirmar pelo humano |
| `santander_card` | Santander | fatura de cartão | **PDF** (v1, T-117b) — cifrado RC4, layout em colunas | `Fatura_092026_..._MASTER_....PDF` | ✓ sonda ok |
| `santander_account` | Santander | extrato de conta | sem OFX; CSV/planilha **a confirmar pelo humano** (Fase 4) | — | ⏳ a confirmar pelo humano |
| `mercadopago_card` | Mercado Pago | fatura de cartão | **PDF** (v1, T-117c) — cifrado AES-256, fonte CID | `Fatura_MP_20260720.pdf` | ✓ sonda ok |
| `mercadopago_account` | Mercado Pago | extrato de conta | sem OFX; CSV/planilha **a confirmar pelo humano** (Fase 4) | — | ⏳ a confirmar pelo humano |

OFX já foi verificado e não existe em nenhum dos três. O que resta procurar é **CSV ou planilha**, insumo da Fase 4: a opção de exportar/baixar ao lado da fatura ou do extrato, no internet banking do desktop (costuma oferecer mais formatos que o app).

Para cada linha, registrar: formato obtido, canal onde foi encontrado, e o arquivo de exemplo salvo (anonimizado) em `lib/import/__fixtures__/<bank_key>.<ext>`.

## 2. Sonda de PDF (2026-09-09 e 10): **os três têm camada de texto**

Três rodadas: extrator artesanal (zlib + `Tj`/`TJ`), análise estrutural do arquivo, e nova extração sobre cópias **sem senha** salvas pelo humano.

| Arquivo | Cifrado | Camada de texto | Mecânica de extração | Veredito |
|---|---|---|---|---|
| `Nubank_2026-09-09.pdf` | não | **sim** — 171 runs | Strings literais `(...)`. Fonte Type0 com subset customizado: glifos deslocados por offset constante (−10 do code point). **Decodificar pelo `ToUnicode` CMap do arquivo**, nunca por offset chumbado. | **PDF viável** |
| Santander (fatura de cartão) | **sim** (RC4) | **sim** — 884 runs, após decifrar | Strings literais, mas **cada célula é um run posicionado**: das 884 linhas de texto, apenas **1** trazia data e valor juntos. Exige **remontar a linha por coordenada** (agrupar por `y`, ordenar por `x`). | **PDF viável** |
| Mercado Pago (fatura de cartão) | **sim** (AES-256) | **sim** — 456 operações `TJ`, 7 CMaps `ToUnicode` | Strings **hexadecimais com fonte CID** (`[<003600…>] TJ`), zero strings literais. Decodificação via `ToUnicode` é **obrigatória** — foi por isso que o extrator artesanal devolveu 0 mesmo decifrado, e não por falta de texto. | **PDF viável** |

**Conclusão:** nenhum dos três exige OCR nem colagem manual. `pdfjs-dist` cobre as três mecânicas (decifragem, `ToUnicode` de subset e de CID, e coordenadas por item de texto). A rotina mensal da família é **subir três PDFs**, informando senha em dois.

**Requisitos que a sonda gerou:**

1. **RF-IMP-11** — campo de senha no upload (Santander RC4, Mercado Pago AES-256). Cópia salva sem senha também funciona, mas não deve ser exigida do usuário.
2. **RF-IMP-12** — **remontagem de linha por coordenada**, comum aos três bancos. É infraestrutura compartilhada em `lib/import/pdf/`, não código por banco.
3. **Nunca** decodificar texto de PDF por offset de glifo chumbado: sempre pelo `ToUnicode` do próprio arquivo.

> **Atenção com as fixtures:** estes PDFs contêm nome completo, número parcial de cartão e endereço. Fixture só entra no repo **anonimizada** (CONVENTIONS §9).

## 3. Os caminhos de entrada

Todos convergem para a **mesma tela de confirmação editável** (SPEC §5.1, RF-IMP-02). Nada é gravado antes da confirmação do usuário.

| # | Caminho | Formato | Confiança | Quando usar |
|---|---------|---------|-----------|-------------|
| 1 | **OFX** | `.ofx` | alta | v1.  melhor caso: data, valor, sinal e `FITID` único já padronizados |
| 2 | **CSV** | `.csv` | alta | **Fase 4 (T-105).** Precisa de mapeamento de colunas salvo por banco. Na v1, `.csv` é recusado com orientação para colar o conteúdo |
| 3 | **XLS/XLSX** | planilha | alta | **Fase 4 (T-118).** Mesma maquinaria de mapeamento do CSV, com leitura de planilha na borda. Na v1, recusado com orientação para colar o conteúdo |
| 4 | **PDF** (com senha, quando cifrado) | `.pdf` | média | **v1, caminho principal.** Nubank confirmado (T-117); Santander e Mercado Pago cifrados, esperados via T-117b/c com senha. Layout muda com redesign; a tela de confirmação é a rede de proteção |
| 5 | **Texto colado** | cola livre | baixa | **v1, fallback universal** (T-119). Cobre qualquer banco e qualquer formato, inclusive PDF que não cede texto e CSV/XLSX enquanto T-105 e T-118 não existem: o usuário abre o arquivo e cola o conteúdo |

**O caminho 5 elimina o "fora de escopo".** Não existe mais banco sem forma de entrada: no pior caso, cola o texto, o parser heurístico interpreta o que consegue, marca a confiança de cada linha, e o que ele não entendeu aparece editável na tela de confirmação. OCR continua fora de escopo — converter imagem em texto é tarefa do usuário, por fora do app.

## 3.1 Consequência do adiamento de CSV e XLSX, e da ausência de OFX

Enquanto T-105 e T-118 não existirem, um banco que ofereça apenas planilha ou CSV entra por **texto colado**: abrir o arquivo, copiar o conteúdo, colar no card. Funciona, mas exige mais conferência na tela de confirmação, porque o parser heurístico não conhece as colunas. É o custo aceito da decisão, e o motivo de as duas tarefas estarem na Fase 4 e não descartadas.

Com OFX inexistente e CSV/XLSX adiados, o PDF é o caminho principal da v1 — e a sonda (§2) confirmou que os três bancos são atendidos por ele. A rotina mensal é **subir três PDFs**, com senha em dois. O texto colado não é caminho diário: é rede de segurança para quando um layout mudar, e para qualquer origem futura. T-100 segue apenas como insumo da Fase 4 (existe CSV ou planilha nesses bancos?).

## 4. Regra permanente

Todo `bank_key` novo entra por aqui antes de virar código: linha nesta tabela + fixture anonimizada + `import_mappings` semeado. Nenhum parser é escrito a partir de suposição sobre o formato — exceto o de texto colado, que é heurístico por natureza e não tem `bank_key`.

## 5. Checklist de captura

Objetivo: fechar o que a tabela §1 marca como **a confirmar pelo humano** — se cada banco oferece **CSV ou planilha (.xls/.xlsx)** na exportação. O caminho até a opção de exportar varia por banco e por canal (desktop vs app), então **nenhuma rota de menu é assumida aqui**: quem localiza a opção é o humano, no internet banking do desktop.

### Onde salvar: dois lugares, e a diferença importa

| Conteúdo | Onde | Versionado? |
|---|---|---|
| **Arquivo real do banco**, como veio | `E:\APPFIN\.private\<bank_key>.<ext>` | **Não.** `.private/` entra no `.gitignore` |
| **Fixture anonimizada**, derivada do real | `lib/import/__fixtures__/<bank_key>.<ext>` | Sim |

Arquivo real **nunca** é salvo dentro de `lib/import/` nem em qualquer caminho versionado. Estas faturas contêm nome completo, dígitos de cartão e endereço; uma vez commitadas, saem do histórico do git só com reescrita de história. O fluxo é: humano salva o bruto em `.private/` → um agente Claude gera a versão anonimizada em `__fixtures__/` → só a anonimizada é versionada.

### Por banco

Para cada um dos três, o mesmo roteiro:

- [ ] Baixar a **fatura de cartão** e o **extrato de conta**.
- [ ] Na opção de exportar/baixar, procurar as extensões `.csv`, `.xls`, `.xlsx` além do PDF.
- [ ] Salvar em `.private/` com o nome do `bank_key`: `nubank_card`, `nubank_account`, `santander_card`, `santander_account`, `mercadopago_card`, `mercadopago_account`.
- [ ] Registrar na tabela §1 o formato encontrado e o canal onde estava.

Particularidades já conhecidas: a fatura do Nubank vem sem senha; a do Santander é cifrada com RC4; a do Mercado Pago com AES-256 (§2).

> **Não bloqueia a v1:** este levantamento de CSV/planilha é insumo da Fase 4 (T-105, T-118). A v1 entrega PDF + texto colado e não depende dele.

## 6. Layout medido da fatura Nubank (2026-09-16)

> Medido pelo Orquestrador sobre uma fatura **real** (`Nubank_2026-09-09.pdf`, 5 páginas, 595×842pt,
> não cifrada). O arquivo vive em `.private/` e **não** é acessível aos agentes implementadores, que
> rodam em provedor de terceiro (RNF-01). Esta seção é a forma anonimizada: coordenadas e máscaras
> de formato, onde **letra virou `A` e dígito virou `9`**. Nenhum estabelecimento, valor ou nome real
> aparece aqui — por isso ela pode ser lida por qualquer agente.

### 6.1 Colunas da linha de transação (página 5)

| Coluna | x | Máscara | Observação |
|---|---|---|---|
| Data | `123` | `99 AAA` | `dd MMM` em pt-BR (`15 SET`). **Sem ano** |
| Cartão | `172` | `•••• 9999` | **Opcional** — só em parte das linhas |
| Descrição | `185` **ou** `214` | livre | `185` sem coluna de cartão, `214` com ela |
| Valor | `~491–508` | `A$ 9.999,99` | **Alinhado à direita**: o x varia com o tamanho |

**Quatro armadilhas que essa medição revelou**, e que valem mais que a tabela:

1. **A descrição não tem x fixo.** Salta de `185` para `214` quando a linha traz `•••• 9999`.
   Chumbar um único x perde metade dos lançamentos. Detecte a presença da coluna de cartão e
   desloque, ou case por faixa.
2. **O valor é alinhado à direita**, então o x inicial muda conforme o número (`x=508` para `R$ 9,99`,
   `x=496` para `R$ 999,99`). Só faixa (`x > 450`) funciona; igualdade não.
3. **Existem linhas de continuação sem data**, ancoradas em `x=214`, com conversão de câmbio
   (`AAA 99.99 = AAA 9.99` e `AAAAAAAAA: AAA 9.99 = AAA 9 = A$ 9,99`). Pertencem à transação
   anterior. Se o parser as tratar como lançamento, inventa despesa; se as descartar em silêncio,
   viola a regra de não engolir linha. **Anexe à transação de cima.**
4. **Parcela vem embutida na descrição**, no fim, como `- AAAAAAA 99/99` ou `- AAAAAAA 9/9`.
   É o formato que o detector do T-121 já cobre — chame-o, não reescreva.

### 6.2 De onde sai o ano

A linha de transação **não tem ano**. Ele está no cabeçalho, repetido em **todas** as páginas:

- `y=782, x=327` → `AAAAAA 99 AAA 9999` (a data da fatura)
- `y=782, x=442` → `AAAAAAA A AAAAA 99 AAA 9999` (emissão e envio)
- página 1, `y=438` → `Data de vencimento: dd MMM yyyy`
- página 1, `y=415` → `Período vigente: dd MMM a dd MMM`

Ordem obrigatória para resolver o ano: **cabeçalho → parâmetro do chamador → linha com confiança
baixa para o usuário completar**. Nunca do relógio. Assumir "ano atual" quebra em silêncio toda
janeiro, quando se importa a fatura de dezembro.

### 6.3 Cabeçalho e rodapé a ignorar

Repetem em toda página e **não** são transação: `y=795` (nome do titular), `y=782` (fatura/emissão),
`y≈21` (`9 AA 9`, o "n de 5"). O rodapé institucional da página 3 ocupa `y=120` a `y=35`.
O cabeçalho da seção de transações é `y=732`: `AAAAAAAAAA` + `AA 99 AAA A 99 AAA`.

## 7. Layout medido da fatura Mercado Pago (2026-09-16)

> Medido pelo Orquestrador sobre fatura **real** (`MercadoPago_2026-07-20.pdf`, 6 páginas). Abriu
> **sem senha** — o humano forneceu cópia decifrada. Forma anonimizada: letra `A`, dígito `9`.

| Coluna | x | Máscara | Observação |
|---|---|---|---|
| Data | `40` | `99/99` | **`dd/MM` com barra** — diferente do Nubank |
| Descrição | `94` | livre | |
| Parcela | `~393–397` | `AAAAAAA 9 AA 99` | **coluna própria** (`Parcela 1 de 12`) |
| Valor | `~507–518` | `A$ 999,99` | alinhado à direita |

**Três diferenças que quebram um parser copiado do Nubank:**

1. **A parcela tem coluna própria** (`x≈395`), não vem colada no fim da descrição. O detector do
   T-121 continua servindo para interpretar o texto, mas a **extração** é de outra coluna.
2. **A fatura agrupa por cartão.** Linhas `AAAAAA AAAA [************9999]` em `x=40` abrem uma seção,
   e os lançamentos abaixo pertencem àquele cartão. Uma fatura traz **vários cartões**. Ignorar isso
   mistura gastos de cartões diferentes num só.
3. **Linhas de subtotal se parecem com lançamento.** `y=368` e `y=437` têm `x=40 "AAAAA"` (a palavra
   *Total*) e um valor em `x≈513`, mas **nenhuma data**. Se entrarem como transação, dobram o gasto
   do mês. Exija data válida em `x=40`; palavra naquela posição é cabeçalho ou subtotal.

O ano não está na linha (`dd/MM`); está no cabeçalho, `y=776`: `AAAAAAAAAA: 99/99/9999`.

## 8. Layout medido da fatura Santander (2026-09-16)

> Medido pelo Orquestrador sobre fatura **real** (`Santander_2026-09.pdf`, 4 páginas). Abriu **sem
> senha** (cópia decifrada). pdfjs emite `Incorrect 'loca' table length` e se recupera sozinho —
> é ruído de fonte, não erro. Forma anonimizada: letra `A`, dígito `9`.

**É o layout mais hostil dos três.** Duas características sem paralelo nos outros:

**1. Data e descrição vêm FUNDIDAS num único run.** Em `x=33`: `"99/99 AAAAAAAAA AA AAAAAA-AAAAAAAA"`.
Não são colunas separadas — é `dd/MM` + espaço + descrição, no mesmo item de texto. A separação é
por **parsing da string**, não por coordenada.

**2. ⚠️ Duas tabelas independentes dividem as mesmas linhas `y`.** A tabela de lançamentos ocupa
`x < 250`; um quadro-resumo ocupa `x > 320` (`(-) AAAAA AA AAAAAAAA`, `(=) AAAAA AAAAA AAAAAA`).
Na mesma `y=425` convivem um lançamento e uma linha de resumo que **não têm relação nenhuma**.

> Consequência direta para o `groupIntoRows`: **agrupar só por `y` corrompe o Santander.** A linha
> montada juntaria a descrição de uma compra com o rótulo de um totalizador. É preciso **segmentar
> também por faixa de `x`** antes de unir as células. Este é o caso que o RF-IMP-12 tem de cobrir, e
> é a razão de a infra de remontagem ser comum aos três bancos em vez de código por banco.

| Elemento | x | Máscara | Observação |
|---|---|---|---|
| Data + descrição | `33` | `99/99 AAAA…` | **fundidas**, separar por string |
| Data auxiliar | `168` | `99/99` | opcional |
| Valor | `~201–214` | `999,99` / `-9.999,99` | **sem `R$`**, sinal por `-`, à direita |
| Marcador | `16–17` | `9` | dígito solto, fora da tabela |
| Quadro-resumo | `> 320` | — | **não é lançamento** |

### 8.2 De onde sai o ano (medido em 2026-09-17)

A linha de lançamento do Santander traz `dd/MM` **sem ano**, igual ao Nubank e ao Mercado Pago. Mas
o ano existe no arquivo, em data completa `dd/MM/aaaa`:

| Página | y | x | Máscara |
|---|---|---|---|
| 2 | 748 | 401 | `99/99/9999` |
| 2 | 689 | 499 | `99/99/9999` |
| 2 | 195 | 527 | `99/99/9999` |

Nenhuma ocorrência nas páginas 1, 3 e 4 — todas vivem no bloco-resumo da página 2. O rótulo de 10
caracteres em `y=761, x=412` encabeça a coluna do primeiro (`x=401`), que é a data de vencimento.

**Regra para o parser, e ela é deliberadamente robusta em vez de posicional:** procure a **primeira
ocorrência de `\d{2}/\d{2}/\d{4}` fora da área de lançamentos** (`x > 250`, onde fica o
quadro-resumo) e use o ano dela. Não fixe `y=748`: a altura do bloco-resumo depende de quanto texto
promocional o banco imprimiu acima, e isso muda a cada fatura.

Ordem obrigatória, igual aos outros dois bancos: **cabeçalho → parâmetro do chamador → linha com
confiança baixa** para o usuário completar. Nunca do relógio.
