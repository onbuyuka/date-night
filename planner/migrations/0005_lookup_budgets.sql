CREATE TABLE provider_usage (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('tomtom', 'tavily')),
  requested_at INTEGER NOT NULL
);

CREATE INDEX provider_usage_window ON provider_usage(provider, requested_at);
