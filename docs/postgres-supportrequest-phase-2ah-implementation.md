# Phase 2AH — PostgreSQL Support Requests

Incremental, additive migration of the MongoDB **SupportRequest** domain to
PostgreSQL, following the architecture established in Phases 2A–2AA and the
audit in `docs/postgres-supportrequest-phase-2ah.md` (PR #39, Option A).

The audit is unchanged and still authoritative for the domain inventory; this
document records the implementation that the audit recommended.

## Scope

Only the SupportRequest domain is migrated in this phase:

- `backend/src/db/migrations/033_create_support_requests.sql`
- `backend/src/repositories/supportRequestRepository.js`
- `backend/src/services/supportRequestService.js`
- minimal controller integration in `backend/src/controllers/devoteeController.js`
  (the four SupportRequest handlers only)
- tests + documentation

**Not migrated:** Notification, Instruction, AttendanceLocation, InventoryIssue,
Recipe, RestockHistory, ShiftAssignment, TransferRequest, or any other Mongo-only
model. No Task, CashClosing, Supplier, Purchase Order, GRN, Inventory, Asset or
Repair work happens here. MongoDB is still present, Mongoose is still the
fallback, and no production data is migrated, backfilled or cut over.

## Pre-implementation re-verification

Every audit claim was re-checked against the repository before implementing.
No material finding contradicted the audit. Two design points were refined, both
of which the audit explicitly left open ("do not blindly implement the proposed
CHECK constraints"; "inspect the actual SQL strategy before deciding whether an
email index is necessary"):

1. **The proposed `status` NOT NULL was wrong for behaviour parity.** The audit's
   table marked `status` `NOT NULL`. Compiling the real Mongoose schema shows
   `status` is `{ default, enum }` but **not** `required`, so an explicit
   `{"status": null}` validates in Mongo and is stored as `null`. `NOT NULL`
   would turn that accepted write into a 500. The column is therefore
   `NULLABLE DEFAULT 'Open'`, matching `cash_closings.status` (031).
2. **The proposed `(lower(email), created_at DESC)` functional index is not
   usable.** `getSupportRequests` lowercases the *query* value but compares it
   against the email stored *as supplied* (`SupportRequest.find({ email })`), so
   the implemented predicate is a plain `email = $1` equality. A `lower(email)`
   index would not serve it. A raw `(email, created_at DESC)` compound index is
   used instead, following `idx_notifications_audience_email_created_at` (024).

The four required columns and the `status` enum are the only CHECKs, because
MongoDB genuinely rejects those writes (verified against the real schema).

## Mongoose model inspected

`backend/src/models/SupportRequest.js`:

```
name     String   required, trim
email    String   required, trim            (no lowercase, no email validator)
subject  String   required, trim
message  String   required, trim
reply    String   trim                      (no default, not required)
status   String   enum [Open, In Progress, Closed], default 'Open'   (not required)
read     Boolean  default false             (not required)
         timestamps: true → createdAt, updatedAt
```

No index, no unique constraint, no reference/ObjectId, no hook, no virtual, no
sub-document. Verified by compiling the real schema: `schema.indexes()` is `[]`
and the only paths are the seven above plus `_id`/`createdAt`/`updatedAt`/`__v`.

## Table

`support_requests` — 10 columns (id + the 7 schema fields + the two timestamps):

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `TEXT` | PK | — | 24-hex Mongo ObjectId |
| `name` | `TEXT` | NOT NULL | — | CHECK non-empty (required + trim) |
| `email` | `TEXT` | NOT NULL | — | CHECK non-empty; NOT unique, NOT lowercased |
| `subject` | `TEXT` | NOT NULL | — | CHECK non-empty (required + trim) |
| `message` | `TEXT` | NOT NULL | — | CHECK non-empty (required + trim) |
| `reply` | `TEXT` | NULL | — | optional, no default |
| `status` | `TEXT` | NULL | `'Open'` | CHECK `IN ('Open','In Progress','Closed')` |
| `read` | `BOOLEAN` | NOT NULL | `false` | |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | |

Indexes: PK on `id`; `idx_support_requests_created_at (created_at DESC)`;
`idx_support_requests_email_created_at (email, created_at DESC)`.

Constraints: the primary key, four non-empty CHECKs and the status enum CHECK.
**No unique constraint. No foreign key.** No `priority`, `category`,
`requester_id`, `assigned_user_id`, `comments`, `attachments` or resolution
fields — the model declares none, so none are invented.

### Behaviour parity of the four Mongoose validator cases

| Schema shape | Mongo behaviour | PostgreSQL |
|---|---|---|
| `required: true` + `trim` (name/email/subject/message) | omitted, `null`, `''` and whitespace all fail | `NOT NULL` + CHECK `<> ''` |
| `default` + enum, not required (`status`) | omitted → `'Open'`; explicit `null` accepted | nullable `DEFAULT 'Open'`; CHECK passes for `null` |
| `trim`, not required, no default (`reply`) | omitted stays absent; `null` accepted; blank stores `''` | nullable, no default; `''` preserved |
| `default`, not required (`read`) | omitted → `false`; explicit `null` accepted | `NOT NULL DEFAULT false`; `null` collapses to the default |

`status` declares no `trim`, so `' Open '` is rejected exactly as Mongo rejects
it. `email` is stored as supplied — the pre-existing query-lowercase mismatch is
preserved, not silently fixed.

## Repository

`backend/src/repositories/supportRequestRepository.js` — mirrors the established
pattern (`query` from `../config/postgres`, `dbConfig.isDbConnected()` fallback,
`toDoc`/`toRow`, parameterized SQL, `DEFAULT_ORDER`, whitelisted sort columns).

Operations, each corresponding to a real call site:

| Operation | Mirrors |
|---|---|
| `create` | `SupportRequest.create(...)` |
| `findMany` | `SupportRequest.find(filter).sort({ createdAt: -1 })` |
| `findById` | `SupportRequest.findById(id)` |
| `updateById` | reply path: `findById` → mutate → `save()` (validators run) |
| `markRead` | `findByIdAndUpdate(id, { read: true }, { new: true })` |

**No delete operation** exists at any layer, because the application has none.
`updateById` and `markRead` are separate because the controller's two Mongoose
calls differ: the reply path uses `save()` (which runs document validators) while
the read path uses `findByIdAndUpdate` with no `runValidators`.

`toDoc` maps `_id → _id`/`id`, `createdAt → createdAt`, `updatedAt → updatedAt`
so the controller and frontend keep the exact response shape. An omitted `reply`
reads back as `undefined` (not `null`), as an unset Mongoose path does.

No repository-level PostgreSQL connectivity probing: the repository reads
`dbConfig.isDbConnected()` and routes to Mongoose when the seam says Mongo.

## Service

`backend/src/services/supportRequestService.js` owns datasource selection:

- PostgreSQL when `dbConfig.isDbConnected()` **and** `isPostgresConnected()`;
- otherwise the existing Mongoose `SupportRequest` model.

One datasource per request, no dual writes, Mongo fallback preserved, no global
datasource refactor. The seam is read through `dbConfig` at call time rather than
destructured at require time, so tests and runtime can flip it in-process.

## Controller

`devoteeController.js` — only the four SupportRequest handlers changed; they now
call the service. URLs, HTTP methods, response shapes, status codes, error
messages, validation, defaults, filtering, sorting and the notification side
effect are unchanged. Every other devotee handler is untouched.

| Handler | Route | Behaviour preserved |
|---|---|---|
| `submitSupportRequest` | `POST /support` | 400 without subject/message; `name` defaults to `Anonymous Devotee`, `email` to `support@devotee.com`; 201 `{ status, message, request }`; one notification |
| `getSupportRequests` | `GET /support` | optional `?email=` trimmed+lowercased; `createdAt DESC`; no pagination; 200 `{ requests }` |
| `replySupportRequest` | `PATCH /support/:id` | 400 without reply; valid enum status preserved, anything else becomes `Closed`; one notification; 404 when missing |
| `markSupportRequestAsRead` | `PATCH /support/:id/read` | `read = true`; 200 `{ supportRequest }`; 404 when missing |

Routes are unchanged: all four endpoints remain, mounted at both
`/api/devotee/support` and `/api/devotees/support` by `app.js`. These routes
carry **no auth middleware** — that is the pre-existing state and is deliberately
not redesigned in this phase.

## Notification integration

SupportRequest create/reply still calls the pre-existing
`notificationPersistenceService.create` exactly once per operation. Notification
is **not** migrated here, its datasource selection is untouched, and no dual
notification write is introduced: the SupportRequest write goes to exactly one
datasource and the notification side effect fires exactly once on either path.

## Error behaviour note

A malformed `:id` on the Mongo path raises a Mongoose `CastError` (→ 500). The
PostgreSQL repository passes the primary id through as TEXT, so a malformed id
resolves to "not found" (→ 404). This is the established convention across every
migrated domain (see `postgres-suppliers.test.js`) and is not changed here.

## Tests

- `backend/test/postgres-support-requests.test.js` — migration shape
  (columns, `id` PK, no FK, no UNIQUE, status CHECK, indexes, idempotency, chain
  029→033), ObjectId round-trip, defaults, required/trim/enum/null parity,
  `read` handling, listing order, email filtering, pagination, reply/mark-read,
  no-delete, datasource selection, no dual writes.
- `backend/test/postgres-support-requests-controllers.test.js` — all four
  handlers on the PG path and on the Mongo fallback, defaults, 400/404 branches,
  status fallback, response shapes, route assertions, one-notification-per-write,
  datasource switching, unrelated-handler regression.
- `backend/test/postgres-migrate.test.js` — migration count 32 → 33 and the new
  filename in the ordered chain.

## Confirmation

No Mongo data was migrated, backfilled or cut over. No dual writes exist. The
Mongoose model and fallback remain. Notification, Instruction,
AttendanceLocation, InventoryIssue, Recipe, RestockHistory, ShiftAssignment,
TransferRequest and every other Mongo-only model are untouched. No FK and no
unique email constraint were introduced.
