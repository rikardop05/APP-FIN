CREATE TABLE "credit_card_holders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"credit_card_id" uuid NOT NULL,
	"last4" text NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_card_holders_credit_card_id_last4_unique" UNIQUE("credit_card_id","last4"),
	CONSTRAINT "credit_card_holders_last4_format" CHECK ("credit_card_holders"."last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "credit_card_holders" ADD CONSTRAINT "credit_card_holders_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_holders" ADD CONSTRAINT "credit_card_holders_credit_card_id_credit_cards_id_fk" FOREIGN KEY ("credit_card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_holders" ADD CONSTRAINT "credit_card_holders_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;