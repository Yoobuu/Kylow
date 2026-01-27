ALTER TABLE system_settings
    ADD COLUMN hyperv_winrm_https_enabled BOOLEAN;

ALTER TABLE system_settings
    ADD COLUMN hyperv_winrm_http_enabled BOOLEAN;

UPDATE system_settings
SET hyperv_winrm_https_enabled = TRUE
WHERE hyperv_winrm_https_enabled IS NULL;

UPDATE system_settings
SET hyperv_winrm_http_enabled = FALSE
WHERE hyperv_winrm_http_enabled IS NULL;
