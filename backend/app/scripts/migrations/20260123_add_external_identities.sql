CREATE TABLE IF NOT EXISTS external_identities (
    id TEXT PRIMARY KEY,
    provider VARCHAR(32) NOT NULL DEFAULT 'microsoft',
    tenant_id VARCHAR(64) NOT NULL,
    external_oid VARCHAR(128) NOT NULL,
    email VARCHAR(320),
    user_id INTEGER,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT uq_external_identities_provider_tenant_oid UNIQUE (provider, tenant_id, external_oid),
    CONSTRAINT fk_external_identities_user_id FOREIGN KEY (user_id) REFERENCES "user" (id)
);

CREATE INDEX IF NOT EXISTS ix_external_identities_user_id ON external_identities (user_id);
CREATE INDEX IF NOT EXISTS ix_external_identities_email ON external_identities (email);
