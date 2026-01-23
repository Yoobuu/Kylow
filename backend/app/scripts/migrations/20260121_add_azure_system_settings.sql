ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS azure_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS azure_refresh_interval_minutes INTEGER NOT NULL DEFAULT 60;

UPDATE system_settings
SET azure_enabled = FALSE
WHERE azure_enabled IS NULL;

UPDATE system_settings
SET azure_refresh_interval_minutes = 60
WHERE azure_refresh_interval_minutes IS NULL;
