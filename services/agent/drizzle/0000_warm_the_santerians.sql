CREATE TYPE "public"."confirmation_status" AS ENUM('pending', 'consumed', 'expired');--> statement-breakpoint
CREATE TABLE "confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"shipper_ref" text NOT NULL,
	"actor" text DEFAULT 'agent' NOT NULL,
	"status" "confirmation_status" DEFAULT 'pending' NOT NULL,
	"conversation_id" text,
	"booking_id" uuid,
	"final_status" text,
	"execution_meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "confirmations_token_unique" UNIQUE("token")
);
