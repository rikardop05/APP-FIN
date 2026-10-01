CREATE TABLE "skipped_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"recurring_expense_id" uuid,
	"income_id" uuid,
	"competence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skipped_occurrences_one_origin" CHECK (("skipped_occurrences"."recurring_expense_id" is not null) <> ("skipped_occurrences"."income_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "skipped_occurrences" ADD CONSTRAINT "skipped_occurrences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skipped_occurrences" ADD CONSTRAINT "skipped_occurrences_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skipped_occurrences" ADD CONSTRAINT "skipped_occurrences_income_id_incomes_id_fk" FOREIGN KEY ("income_id") REFERENCES "public"."incomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skipped_occurrences_expense_competence_unique" ON "skipped_occurrences" USING btree ("household_id","recurring_expense_id","competence") WHERE "skipped_occurrences"."recurring_expense_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "skipped_occurrences_income_competence_unique" ON "skipped_occurrences" USING btree ("household_id","income_id","competence") WHERE "skipped_occurrences"."income_id" is not null;