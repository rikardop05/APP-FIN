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
