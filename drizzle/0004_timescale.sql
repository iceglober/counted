CREATE EXTENSION IF NOT EXISTS timescaledb;--> statement-breakpoint
SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE, migrate_data => TRUE);
