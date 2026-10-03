CREATE TABLE "investment_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"portfolio_cents" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_snapshots_portfolio_cents_non_negative" CHECK ("investment_snapshots"."portfolio_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "investment_snapshots" ADD CONSTRAINT "investment_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "investment_snapshots_household_id_as_of_unique" ON "investment_snapshots" USING btree ("household_id","as_of");