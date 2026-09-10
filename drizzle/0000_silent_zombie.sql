CREATE TYPE "public"."account_kind" AS ENUM('checking', 'savings', 'cash', 'brokerage');--> statement-breakpoint
CREATE TYPE "public"."card_brand" AS ENUM('visa', 'mastercard', 'elo', 'amex', 'other');--> statement-breakpoint
CREATE TYPE "public"."category_nature" AS ENUM('essential', 'non_essential', 'investment', 'income');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('monthly', 'bimonthly', 'quarterly', 'semiannual', 'annual', 'one_off');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'achieved', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."import_format" AS ENUM('ofx', 'csv', 'xlsx', 'pdf', 'text');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('pending', 'committed', 'reverted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."income_kind" AS ENUM('salary', 'pro_labore', 'variable', 'rent', 'other');--> statement-breakpoint
CREATE TYPE "public"."match_type" AS ENUM('contains', 'regex', 'exact');--> statement-breakpoint
CREATE TYPE "public"."record_source" AS ENUM('import', 'manual', 'generated');--> statement-breakpoint
CREATE TYPE "public"."scenario_label" AS ENUM('conservative', 'moderate', 'optimistic');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('open', 'closed', 'paid');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('expense', 'income', 'transfer', 'credit_card_payment', 'investment_contribution');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('posted', 'planned');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bank" text,
	"kind" "account_kind" NOT NULL,
	"opening_balance_cents" bigint DEFAULT 0 NOT NULL,
	"opening_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"period" text NOT NULL,
	"category_id" uuid NOT NULL,
	"planned_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"nature" "category_nature" NOT NULL,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"match_type" "match_type" DEFAULT 'contains' NOT NULL,
	"category_id" uuid NOT NULL,
	"member_id" uuid,
	"priority" integer DEFAULT 100 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bank" text,
	"brand" "card_brand" DEFAULT 'other' NOT NULL,
	"holder_member_id" uuid,
	"payment_account_id" uuid,
	"credit_limit_cents" bigint,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_cents" bigint NOT NULL,
	"target_date" date,
	"current_cents" bigint DEFAULT 0 NOT NULL,
	"account_id" uuid,
	"priority" integer DEFAULT 100 NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"is_emergency_fund" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_settings" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"emergency_fund_months" smallint DEFAULT 6 NOT NULL,
	"budget_warn_bp" integer DEFAULT 8000 NOT NULL,
	"projection_months" smallint DEFAULT 12 NOT NULL,
	"commitment_months" smallint DEFAULT 24 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"bank_key" text,
	"format" "import_format" NOT NULL,
	"credit_card_id" uuid,
	"account_id" uuid,
	"statement_id" uuid,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"rows_duplicated" integer DEFAULT 0 NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"bank_key" text NOT NULL,
	"format" "import_format" NOT NULL,
	"column_map" jsonb NOT NULL,
	"date_format" text NOT NULL,
	"decimal_separator" text DEFAULT ',' NOT NULL,
	"amount_sign_inverted" boolean DEFAULT false NOT NULL,
	"header_signature" text,
	CONSTRAINT "import_mappings_format_tabular" CHECK ("import_mappings"."format" in ('csv', 'xlsx'))
);
--> statement-breakpoint
CREATE TABLE "incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"description" text NOT NULL,
	"kind" "income_kind" NOT NULL,
	"expected_cents" bigint NOT NULL,
	"receive_day" smallint NOT NULL,
	"frequency" "frequency" DEFAULT 'monthly' NOT NULL,
	"one_off_competence" text,
	"starts_on" date,
	"ends_on" date,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "incomes_one_off_requires_competence" CHECK ("incomes"."frequency" <> 'one_off' or "incomes"."one_off_competence" is not null)
);
--> statement-breakpoint
CREATE TABLE "installment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"description" text NOT NULL,
	"total_cents" bigint NOT NULL,
	"installments_count" smallint NOT NULL,
	"first_competence" text NOT NULL,
	"category_id" uuid,
	"source" "record_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"desired_monthly_income_cents" bigint NOT NULL,
	"current_portfolio_cents" bigint DEFAULT 0 NOT NULL,
	"current_monthly_contribution_cents" bigint DEFAULT 0 NOT NULL,
	"inflation_bp" integer DEFAULT 450 NOT NULL,
	"income_tax_bp" integer DEFAULT 1500 NOT NULL,
	"target_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investment_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investment_plan_id" uuid NOT NULL,
	"label" "scenario_label" NOT NULL,
	"real_return_bp" integer NOT NULL,
	"withdrawal_bp" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"color" text NOT NULL,
	CONSTRAINT "members_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"description" text NOT NULL,
	"expected_cents" bigint NOT NULL,
	"category_id" uuid NOT NULL,
	"due_day" smallint NOT NULL,
	"frequency" "frequency" DEFAULT 'monthly' NOT NULL,
	"account_id" uuid,
	"credit_card_id" uuid,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"annual_adjustment_bp" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"period" text NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"reported_total_cents" bigint,
	"status" "statement_status" DEFAULT 'open' NOT NULL,
	"source" "record_source" NOT NULL,
	"paid_transaction_id" uuid
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"competence" text NOT NULL,
	"cash_date" date,
	"description" text NOT NULL,
	"raw_description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"status" "transaction_status" DEFAULT 'posted' NOT NULL,
	"category_id" uuid,
	"account_id" uuid,
	"credit_card_id" uuid,
	"statement_id" uuid,
	"member_id" uuid,
	"installment_plan_id" uuid,
	"installment_number" smallint,
	"recurring_expense_id" uuid,
	"income_id" uuid,
	"import_batch_id" uuid,
	"dedupe_hash" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_account_xor_credit_card" CHECK (("transactions"."account_id" is not null) <> ("transactions"."credit_card_id" is not null)),
	CONSTRAINT "transactions_installment_number_iff_plan" CHECK (("transactions"."installment_number" is null) = ("transactions"."installment_plan_id" is null))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_holder_member_id_members_id_fk" FOREIGN KEY ("holder_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_payment_account_id_accounts_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_settings" ADD CONSTRAINT "household_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_scenarios" ADD CONSTRAINT "investment_scenarios_investment_plan_id_investment_plans_id_fk" FOREIGN KEY ("investment_plan_id") REFERENCES "public"."investment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_paid_transaction_id_transactions_id_fk" FOREIGN KEY ("paid_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_plan_id_installment_plans_id_fk" FOREIGN KEY ("installment_plan_id") REFERENCES "public"."installment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_expense_id_recurring_expenses_id_fk" FOREIGN KEY ("recurring_expense_id") REFERENCES "public"."recurring_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_income_id_incomes_id_fk" FOREIGN KEY ("income_id") REFERENCES "public"."incomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_household_id_period_category_id_unique" ON "budgets" USING btree ("household_id","period","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_household_id_parent_id_name_unique" ON "categories" USING btree ("household_id","parent_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_household_id_name_root_unique" ON "categories" USING btree ("household_id","name") WHERE "categories"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "import_mappings_household_id_bank_key_unique" ON "import_mappings" USING btree ("household_id","bank_key");--> statement-breakpoint
CREATE UNIQUE INDEX "investment_scenarios_investment_plan_id_label_unique" ON "investment_scenarios" USING btree ("investment_plan_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "statements_credit_card_id_period_unique" ON "statements" USING btree ("credit_card_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_household_id_dedupe_hash_unique" ON "transactions" USING btree ("household_id","dedupe_hash") WHERE "transactions"."dedupe_hash" is not null;--> statement-breakpoint
CREATE INDEX "transactions_household_id_occurred_on_idx" ON "transactions" USING btree ("household_id","occurred_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_household_id_competence_idx" ON "transactions" USING btree ("household_id","competence");--> statement-breakpoint
CREATE INDEX "transactions_statement_id_idx" ON "transactions" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "transactions_household_id_category_id_idx" ON "transactions" USING btree ("household_id","category_id");--> statement-breakpoint
CREATE INDEX "transactions_import_batch_id_idx" ON "transactions" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "transactions_household_id_status_cash_date_idx" ON "transactions" USING btree ("household_id","status","cash_date");