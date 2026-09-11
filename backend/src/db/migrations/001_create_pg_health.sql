-- Infrastructure foundation for the PostgreSQL migration (Phase 1).
-- No business data is migrated here; business tables arrive in later phases.

-- Health/test table lets us verify PostgreSQL connectivity without business state.
CREATE TABLE IF NOT EXISTS pg_health (
  id SERIAL PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);