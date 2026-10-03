-- D7: current_portfolio_as_of e NOT NULL, mas investment_plans JA tem linhas.
-- ADD COLUMN ... date NOT NULL sem default falharia: nao ha valor para as linhas
-- existentes. Um DEFAULT nao resolve: default de coluna nao pode referenciar
-- outra coluna (created_at), e now() gravaria HOJE em vez da data de criacao do
-- plano. Entao: adiciona NULLABLE, faz o backfill (data em America/Sao_Paulo de
-- created_at) e so entao trava NOT NULL. Os tres passos rodam na MESMA transacao
-- da migration (o drizzle-kit envolve cada migration numa transacao).
ALTER TABLE "investment_plans" ADD COLUMN "current_portfolio_as_of" date;--> statement-breakpoint
UPDATE "investment_plans" SET "current_portfolio_as_of" = ("created_at" AT TIME ZONE 'America/Sao_Paulo')::date;--> statement-breakpoint
ALTER TABLE "investment_plans" ALTER COLUMN "current_portfolio_as_of" SET NOT NULL;
