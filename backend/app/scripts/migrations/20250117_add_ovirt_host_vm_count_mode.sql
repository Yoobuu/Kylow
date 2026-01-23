ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS ovirt_host_vm_count_mode TEXT NOT NULL DEFAULT 'runtime';

UPDATE system_settings
SET ovirt_host_vm_count_mode = 'runtime'
WHERE ovirt_host_vm_count_mode IS NULL OR ovirt_host_vm_count_mode = '';
