ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS ovirt_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS ovirt_refresh_interval_minutes INTEGER NOT NULL DEFAULT 60;

UPDATE system_settings
SET ovirt_enabled = FALSE
WHERE ovirt_enabled IS NULL;

UPDATE system_settings
SET ovirt_refresh_interval_minutes = 60
WHERE ovirt_refresh_interval_minutes IS NULL;
