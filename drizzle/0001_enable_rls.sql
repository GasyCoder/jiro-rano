-- Custom SQL migration file, put your code below! --
-- Supabase expose automatiquement le schéma public via son API REST (PostgREST), accessible avec la clé
-- « anon » qui est publique. JIRAMA Share n'utilise pas cette API : toutes les données passent par le
-- serveur, connecté en tant que propriétaire des tables (non soumis à la RLS). Activer la RLS sans
-- aucune politique ferme donc l'accès REST direct, sans rien changer pour l'application.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buildings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "building_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consumers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meter_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bill_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocation_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocation_calculation_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
