CREATE TYPE "public"."allocation_mode" AS ENUM('SUB_METER', 'DIFFERENCE', 'EQUAL_SHARE', 'WEIGHTED_SHARE', 'MANUAL_APPROXIMATION');--> statement-breakpoint
CREATE TYPE "public"."allocation_status" AS ENUM('DRAFT', 'CALCULATED', 'VALIDATED', 'LOCKED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."applied_method" AS ENUM('SUB_METER_EXACT', 'SUB_METER_PRORATED', 'DIFFERENCE', 'EQUAL_SHARE', 'WEIGHTED_SHARE', 'MANUAL_APPROXIMATION', 'MANUAL_OVERRIDE');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('DRAFT', 'CONFIRMED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."building_role" AS ENUM('MANAGER', 'CONTRIBUTOR', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."calculation_status" AS ENUM('NOT_CALCULATED', 'CALCULATED', 'VALIDATED', 'LOCKED', 'OUTDATED');--> statement-breakpoint
CREATE TYPE "public"."consumer_type" AS ENUM('FLOOR', 'APARTMENT', 'STUDIO', 'SHOP', 'GARAGE', 'ANNEX', 'COMMON', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('METER_PHOTO', 'BILL_PHOTO', 'BILL_PDF', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."meter_type" AS ENUM('MAIN', 'SUB_METER', 'WATER', 'COMMON');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('MEASURED', 'PRORATED', 'ESTIMATED', 'MANUAL', 'DIFFERENCE');--> statement-breakpoint
CREATE TYPE "public"."reading_normalization" AS ENUM('INTEGER_TRUNCATE', 'AS_IS');--> statement-breakpoint
CREATE TYPE "public"."reading_source" AS ENUM('MANUAL', 'IMAGE', 'OCR', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SUPERADMIN', 'USER');--> statement-breakpoint
CREATE TYPE "public"."water_mode" AS ENUM('EQUAL', 'PROPORTIONAL', 'MANUAL');--> statement-breakpoint
CREATE TABLE "allocation_calculation_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"consumer_id" uuid,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"formula" text,
	"result" text
);
--> statement-breakpoint
CREATE TABLE "allocation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"consumer_id" uuid NOT NULL,
	"consumer_name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"configured_method" "allocation_mode" NOT NULL,
	"applied_method" "applied_method" NOT NULL,
	"provenance" "provenance" NOT NULL,
	"kwh" numeric(14, 3) NOT NULL,
	"ratio" numeric(12, 10) NOT NULL,
	"electricity_amount" numeric(14, 2) NOT NULL,
	"water_amount" numeric(14, 2) NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"payable_amount" numeric(14, 0) NOT NULL,
	"reading_start_id" uuid,
	"reading_end_id" uuid,
	"measured_kwh" numeric(14, 3),
	"measured_days" numeric(10, 4),
	"weight" numeric(10, 4),
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_items_kwh_check" CHECK ("allocation_items"."kwh" >= 0)
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "allocation_status" NOT NULL,
	"engine_version" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_kwh" numeric(14, 3),
	"total_electricity_amount" numeric(14, 2),
	"total_water_amount" numeric(14, 2),
	"total_amount" numeric(14, 2),
	"total_payable" numeric(14, 0),
	"effective_price_per_kwh" numeric(14, 4),
	"water_mode" "water_mode" NOT NULL,
	"tolerance_ar" numeric(10, 2) NOT NULL,
	"correction_of_id" uuid,
	"correction_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"locked_by" uuid,
	"locked_at" timestamp with time zone,
	"superseded_by_id" uuid,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "allocations_version_check" CHECK ("allocations"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"building_id" uuid,
	"bill_id" uuid,
	"old_value" jsonb,
	"new_value" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" "file_kind" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"days" integer NOT NULL,
	"main_meter_previous_index" numeric(14, 3),
	"main_meter_current_index" numeric(14, 3),
	"electricity_kwh" numeric(14, 3) NOT NULL,
	"electricity_amount" numeric(14, 2) NOT NULL,
	"water_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"invoice_number" text,
	"invoice_date" date,
	"due_date" date,
	"notes" text,
	"status" "bill_status" DEFAULT 'DRAFT' NOT NULL,
	"calculation_status" "calculation_status" DEFAULT 'NOT_CALCULATED' NOT NULL,
	"extracted" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bills_period_check" CHECK ("bills"."period_end" > "bills"."period_start"),
	CONSTRAINT "bills_days_check" CHECK ("bills"."days" > 0),
	CONSTRAINT "bills_kwh_check" CHECK ("bills"."electricity_kwh" > 0),
	CONSTRAINT "bills_amounts_check" CHECK ("bills"."electricity_amount" >= 0 and "bills"."water_amount" >= 0 and "bills"."total_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "building_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "building_role" DEFAULT 'VIEWER' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"consumer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"description" text,
	"jirama_client_number" text,
	"jirama_meter_reference" text,
	"manager_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"default_water_mode" "water_mode" DEFAULT 'EQUAL' NOT NULL,
	"rounding_tolerance_ar" numeric(10, 2) DEFAULT '2' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "buildings_tolerance_check" CHECK ("buildings"."rounding_tolerance_ar" >= 0)
);
--> statement-breakpoint
CREATE TABLE "consumers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"type" "consumer_type" DEFAULT 'FLOOR' NOT NULL,
	"meter_id" uuid,
	"has_sub_meter" boolean GENERATED ALWAYS AS (meter_id is not null) STORED,
	"allocation_mode" "allocation_mode" DEFAULT 'DIFFERENCE' NOT NULL,
	"weight" numeric(10, 4) DEFAULT '1' NOT NULL,
	"water_weight" numeric(10, 4) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "consumers_weight_check" CHECK ("consumers"."weight" > 0),
	CONSTRAINT "consumers_water_weight_check" CHECK ("consumers"."water_weight" >= 0),
	CONSTRAINT "consumers_sub_meter_check" CHECK ("consumers"."allocation_mode" <> 'SUB_METER' or "consumers"."meter_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"kind" "file_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"original_name" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meter_id" uuid NOT NULL,
	"reading_date" date NOT NULL,
	"reading_time" time,
	"value" numeric(14, 3) NOT NULL,
	"normalized_value" numeric(14, 3) NOT NULL,
	"source" "reading_source" DEFAULT 'MANUAL' NOT NULL,
	"photo_file_id" uuid,
	"confidence_score" numeric(4, 3),
	"extracted" jsonb,
	"validated" boolean DEFAULT false NOT NULL,
	"validated_by" uuid,
	"validated_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "meter_readings_value_check" CHECK ("meter_readings"."value" >= 0 and "meter_readings"."normalized_value" >= 0),
	CONSTRAINT "meter_readings_confidence_check" CHECK ("meter_readings"."confidence_score" is null or ("meter_readings"."confidence_score" between 0 and 1))
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"type" "meter_type" NOT NULL,
	"label" text NOT NULL,
	"serial_number" text,
	"unit" text DEFAULT 'kWh' NOT NULL,
	"normalization" "reading_normalization" DEFAULT 'INTEGER_TRUNCATE' NOT NULL,
	"rollover_at" numeric(14, 3),
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "meters_unit_check" CHECK ("meters"."unit" in ('kWh', 'm3')),
	CONSTRAINT "meters_rollover_check" CHECK ("meters"."rollover_at" is null or "meters"."rollover_at" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"locale" text DEFAULT 'fr' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_locale_check" CHECK ("users"."locale" in ('fr', 'mg'))
);
--> statement-breakpoint
ALTER TABLE "allocation_calculation_steps" ADD CONSTRAINT "allocation_calculation_steps_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_calculation_steps" ADD CONSTRAINT "allocation_calculation_steps_consumer_id_consumers_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."consumers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_items" ADD CONSTRAINT "allocation_items_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_items" ADD CONSTRAINT "allocation_items_consumer_id_consumers_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."consumers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_items" ADD CONSTRAINT "allocation_items_reading_start_id_meter_readings_id_fk" FOREIGN KEY ("reading_start_id") REFERENCES "public"."meter_readings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_items" ADD CONSTRAINT "allocation_items_reading_end_id_meter_readings_id_fk" FOREIGN KEY ("reading_end_id") REFERENCES "public"."meter_readings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_correction_of_id_allocations_id_fk" FOREIGN KEY ("correction_of_id") REFERENCES "public"."allocations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_superseded_by_id_allocations_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."allocations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_documents" ADD CONSTRAINT "bill_documents_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_documents" ADD CONSTRAINT "bill_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_documents" ADD CONSTRAINT "bill_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_members" ADD CONSTRAINT "building_members_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_members" ADD CONSTRAINT "building_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_members" ADD CONSTRAINT "building_members_consumer_id_consumers_id_fk" FOREIGN KEY ("consumer_id") REFERENCES "public"."consumers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumers" ADD CONSTRAINT "consumers_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumers" ADD CONSTRAINT "consumers_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_validated_by_users_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_steps_order_unique" ON "allocation_calculation_steps" USING btree ("allocation_id","step_order");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_items_unique" ON "allocation_items" USING btree ("allocation_id","consumer_id");--> statement-breakpoint
CREATE INDEX "allocation_items_readings_idx" ON "allocation_items" USING btree ("reading_start_id","reading_end_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_bill_version_unique" ON "allocations" USING btree ("bill_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_one_official_per_bill" ON "allocations" USING btree ("bill_id") WHERE "allocations"."status" in ('VALIDATED', 'LOCKED');--> statement-breakpoint
CREATE INDEX "audit_logs_building_idx" ON "audit_logs" USING btree ("building_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_bill_idx" ON "audit_logs" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_documents_unique" ON "bill_documents" USING btree ("bill_id","file_id");--> statement-breakpoint
CREATE INDEX "bills_building_period_idx" ON "bills" USING btree ("building_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_invoice_number_unique" ON "bills" USING btree ("building_id","invoice_number") WHERE "bills"."invoice_number" is not null and "bills"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "building_members_unique" ON "building_members" USING btree ("building_id","user_id");--> statement-breakpoint
CREATE INDEX "building_members_user_idx" ON "building_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "consumers_building_idx" ON "consumers" USING btree ("building_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "consumers_meter_unique" ON "consumers" USING btree ("meter_id") WHERE "consumers"."meter_id" is not null and "consumers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "files_storage_key_unique" ON "files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_building_idx" ON "files" USING btree ("building_id");--> statement-breakpoint
CREATE INDEX "meter_readings_meter_date_idx" ON "meter_readings" USING btree ("meter_id","reading_date");--> statement-breakpoint
CREATE INDEX "meters_building_idx" ON "meters" USING btree ("building_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meters_one_main_per_building" ON "meters" USING btree ("building_id") WHERE "meters"."type" = 'MAIN' and "meters"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email")) WHERE "users"."deleted_at" is null;