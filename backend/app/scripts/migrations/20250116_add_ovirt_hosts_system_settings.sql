ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS ovirt_hosts_refresh_interval_minutes INTEGER NOT NULL DEFAULT 60;

UPDATE system_settings
SET ovirt_hosts_refresh_interval_minutes = 60
WHERE ovirt_hosts_refresh_interval_minutes IS NULL;
