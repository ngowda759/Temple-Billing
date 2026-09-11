# PostgreSQL Migration — Phase 1

## Why PostgreSQL?

The application currently depends on MongoDB/Mongoose. This phase introduces PostgreSQL as an additional, production-ready data layer so future phases can migrate models one at a time without a big-bang switchover.

**Important rule:** MongoDB remains the existing source of truth until later migration phases. No business reads or writes go through PostgreSQL yet.

## Configuration

The backend reads PostgreSQL settings from environment variables (`backend/.env`):

- `DATABASE_URL` — connection URL, e.g. `postgresql://username:password@localhost:5432/temple_billing`
- Alternatively, individual `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` values.
- `POSTGRES_SSL` — set to `true` for hosted providers that require SSL (or pass `?sslmode=require` in `DATABASE_URL`). No credentials are hard-coded anywhere.

MongoDB settings (`MONGODB_URI`, etc.) are unchanged and remain required during the migration.

## Running migrations

```bash
cd backend
cp .env.example .env # then set DATABASE_URL
npm install
npm run db:migrate
```

The runner:

- Scans `src/db/migrations/` for `*.sql` files in filename order.
- Bootstraps a `schema_migrations` tracking table on first run.
- Applies each pending migration inside a transaction and records its filename.
- Re-running is safe: applied migrations are skipped, nothing is duplicated.
- A failed migration rolls back that migration and exits with anon-zero code showing which file failed.

## Verifying connectivity

```bash
npm run db:verify
# or via HTTP:
curl http://localhost:5000/api/health
# -> { "status": "ok", "postgres": "connected" }
```

The `GET /api/health` response includes `postgres` (`connected` or `unavailable`) without exposing credentials.



## Planned incremental approach

1. **Phase 1 (this phase):** PostgreSQL pool, migration framework, health check. No business data.
2. **Later phases:** migrate one MongoDB model at a time — schema migration + backfill + dual-write/replay, then cutover.
3. **Finally:** remove Mongoose once every model has moved.

MongoDB remains the source of truth until its model's own migration phase is complete.