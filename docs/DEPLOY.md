# DEPLOY — subir o APPFIN na Vercel

Guia para publicar o APPFIN em produção hoje. Deploy não toca no banco (só lê/escreve em runtime, como o dev local) e não roda migration sozinho.

## 0. Pré-requisitos (contas e valores, tudo fora do repo)

| # | O quê | Onde conseguir |
|---|---|---|
| 1 | Conta Vercel (gratuita) | vercel.com, entrar com o GitHub |
| 2 | Repo no GitHub | `rikardop05/APP-FIN`, branch `main` atualizada |
| 3 | URL **pooled** do Neon | Console do Neon → Connection string com `-pooler-` no host (região `sa-east-1`, São Paulo) |
| 4 | URL **direta** do Neon (só para migrations, na sua máquina) | Mesma tela, opção sem pooler |
| 5 | **Senha de app do Gmail** (sem domínio próprio; 500 e-mails/dia) | Conta Google com verificação em 2 etapas ligada → myaccount.google.com/apppasswords → criar "APPFIN" → copie os 16 caracteres sem espaços |
| 6 | `AUTH_SECRET` novo de produção | `npx auth secret` na sua máquina (nunca reuse o de dev) |

Nada acima entra em arquivo versionado. Segredo mora só na Vercel (produção) e no `.env.local` (dev).

## 1. Importar na Vercel

1. Vercel → Add New → Project → Import `rikardop05/APP-FIN`.
2. Framework: Next.js (detectado sozinho). Root Directory: `./`.
3. **Região: `gru1` (São Paulo)** — o banco Neon está em `sa-east-1` (São Paulo); mesma cidade, latência mínima.
4. Node.js: 22.x (`package.json` exige `>= 22.18`).
5. Não dê deploy ainda: preencha as variáveis primeiro (§2).

## 2. Variáveis de ambiente (produção, na Vercel)

| Variável | Valor (de onde vem) |
|---|---|
| `DATABASE_URL` | URL **pooled** do Neon (§0 item 3), com `sslmode=require` |
| `DATABASE_PREPARE` | `true` (o pooled do Neon aceita prepared statement) |
| `AUTH_SECRET` | gerado agora (§0 item 6) |
| `AUTH_URL` | `https://<seu-projeto>.vercel.app` (a URL que a Vercel der; sem ela o Auth.js recusa subir) |
| `AUTH_ALLOWED_EMAILS` | os 2 e-mails do household, separados por vírgula (os mesmos do dev) |
| `EMAIL_SERVER` | `smtp://SEU_USUARIO%40gmail.com:SENHA_DE_APP@smtp.gmail.com:587` (o `@` do usuário vira `%40`) |
| `EMAIL_FROM` | `APPFIN <SEU_USUARIO@gmail.com>` (o mesmo Gmail; o Gmail reescreve outro remetente) |

> **Por que Gmail e não Resend:** sem domínio próprio, o remetente de teste do Resend (`onboarding@resend.dev`) só entrega ao **dono da conta Resend**, e o segundo e-mail do household não recebe o link. O Gmail com senha de app entrega para qualquer endereço. Se um dia houver domínio próprio, o Resend volta a ser opção: `smtp://resend:CHAVE@smtp.resend.com:587` e `EMAIL_FROM=APPFIN <login@seu-dominio>`.
>
> O primeiro e-mail pode cair no spam de quem recebe; marque "Não é spam" uma vez.

Sem `EMAIL_SERVER` o app **se recusa a iniciar** (guarda de boot, de propósito). Sem `AUTH_URL` dá `UntrustedHost`. As duas falhas são altas e claras no log do deploy — é assim que se descobre variável faltando.

## 3. Migrations (da sua máquina, não na Vercel)

```bash
# Aponta para a conexão DIRETA só nesta sessão, e volta depois:
DATABASE_URL="<url-direta-do-Neon>" npm run db:migrate
```

O `drizzle-kit migrate` abre a própria conexão; DDL vai pela direta para não depender do pooler. Confira no Neon (Table Editor) que as tabelas já estão lá — em geral não há migration nova, é só garantia.

## 4. Deploy e teste do login

1. Deploy na Vercel. Aguarde `Ready`.
2. Abra `https://<seu-projeto>.vercel.app/login`, digite um dos 2 e-mails, abra o magic link no e-mail (vale 15 minutos, uso único).
3. Confira: Painel mostra os mesmos números do dev local (é o mesmo banco); `/fluxo` projeta; logout (`/api/auth/signout`) limpa a sessão.
4. Se algo falhar: Vercel → Deployments → Runtime Logs. Erros de boot dizem exatamente qual variável falta.

## 5. Como reverter

Deploy não migra dado nem mexe no banco: reverter é voltar o deploy na Vercel (Deployments → … → Promote to Production num deploy anterior) ou pausar o projeto. O banco Neon continua intacto nos dois casos.

## 6. Depois do deploy: separe o dev do produção (recomendado)

Hoje o dev local e a produção apontam para o **mesmo banco**. Depois que a produção estiver no ar:

1. No Neon, crie um branch `dev` a partir da produção.
2. Rode o seed nele (`DATABASE_URL="<url-do-branch-dev>" npm run db:seed`) — ele cria a estrutura de teste.
3. Troque o `.env.local` para a URL do branch `dev`.

Sem isso, abrir `/fluxo` no dev completa previsão (`topUpPlanned`) **no banco de produção** — é escrita intencional do app, mas em dado real. Com o branch, o dev nunca toca na Casa de verdade. Testes automatizados já criam household próprio e apagam no fim; a regra continua valendo.

## 7. O que esta auditoria verificou (não precisa refazer)

- **Banco serverless:** `postgres.js` com pool `max: 5` por instância + `idle_timeout`/`connect_timeout` (`lib/db/index.ts`); endpoint pooled multiplexa. Nenhuma rota usa runtime edge (só `nodejs` no Auth; o resto é default Node) — o cliente Postgres nunca vai para a borda; o middleware só importa `authConfig` edge-safe.
- **Auth:** JWT em cookie (sem lookup de banco por request); `AUTH_URL` exigido; allowlist de 2 e-mails checada no envio E no login; SMTP obrigatório em produção com falha alta; link nunca vai para log de produção.
- **Build:** `next.config.ts` mantém `pdfjs-dist` fora do bundle (o worker resolve de `node_modules`, que a Vercel inclui); type/lint quebram o build de propósito. `npm run build` foi validado numa cópia separada — não rode na pasta principal com o dev ligado.
- **PWA:** `public/sw-policy.js` — GET mesmo domínio, nunca `/api/auth`, `/api/backup` nem `/login`; rede primeiro para telas e API; logout e fim de sessão apagam o cache; validade de 24 h. Num aparelho só da família, o cache não cruza sessão.
- **Segurança:** nenhum segredo versionado (só `.env.example`); senha de PDF vive em memória, nunca entra em mensagem de erro nem em log; cabeçalhos `nosniff`/`SAMEORIGIN`/`Referrer-Policy`/`Permissions-Policy` no `next.config.ts` (sem CSP — quebraria scripts inline do Next).
- **Upload:** fatura vai como JSON+base64 (faturas têm KBs, folga no limite de corpo da função); parse de poucas páginas leva segundos.

## 8. Pendente (não bloqueia o teste de hoje)

- Opcional: domínio próprio + Resend, se o Gmail um dia limitar ou cair no spam (hoje: Gmail com senha de app).
- Branch `dev` do Neon (§6).
- `maxDuration` na rota de upload se alguma fatura grande estourar o timeout padrão.
- (Feito em 2026-10-14: os 264 households de teste órfãos foram apagados; o banco tem só a Casa.)
