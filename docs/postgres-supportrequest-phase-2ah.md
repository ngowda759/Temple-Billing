# Phase 2AH — SupportRequest Mongo-only model gap audit

> **Implemented since.** This audit recommended OPTION A — migrate
> `SupportRequest` in a future, separately approved phase. That phase has now
> been merged: `033_create_support_requests.sql`, `supportRequestRepository.js`
> and `supportRequestService.js` exist, and the four devotee handlers were wired
> to the service. The design points below that were left open at audit time were
> resolved — `status` is nullable with an enum CHECK (not `NOT NULL`) and the
> email index is a raw `(email, created_at DESC)` compound index (not a
> `lower(email)` functional index). See
> [postgres-supportrequest-phase-2ah-implementation.md](postgres-supportrequest-phase-2ah-implementation.md)
> for what was actually built. The statements below such as "Proposed … NOT
> implemented" and "Next free prefix after 030/031/032" describe the audit-time
> state and no longer match the repository.

Phase 2AH is an **audit only**. It does not migrate `SupportRequest`, does not
remove MongoDB, does not change datasource selection and does not perform a
cutover. No migration, repository, service, controller, route, model or schema
was created or modified by this phase.

The audit answers one question: is `SupportRequest` a distinct live business
domain that should be migrated to PostgreSQL, an existing/duplicated domain
already represented elsewhere, or a legacy/dead Mongo-only model that does not
currently require migration?

**Finding: `SupportRequest` is a LIVE, DISTINCT domain. Recommendation:
OPTION A — migrate it in a future, separately approved phase.**

## 1. Mongo schema

`backend/src/models/SupportRequest.js` (20 lines):

```js
const supportRequestSchema = new mongoose.Schema(
  {
    name:    { type: String, trim: true, required: true },
    email:   { type: String, trim: true, required: true },
    subject: { type: String, trim: true, required: true },
    message: { type: String, trim: true, required: true },
    reply:   { type: String, trim: true },
    status:  { type: String, enum: ["Open", "In Progress", "Closed"], default: "Open" },
    read:    { type: Boolean, default: false },
  },
  { timestamps: true }
);
module.exports = mongoose.model("SupportRequest", supportRequestSchema);
```

| Aspect | Finding |
|---|---|
| Fields | `name`, `email`, `subject`, `message`, `reply`, `status`, `read` |
| Types | 5 × String, `status` String, `read` Boolean |
| Required | `name`, `email`, `subject`, `message` (all also trimmed) |
| Defaults | `status: "Open"`, `read: false`; `reply` is undefined until set |
| Enums | `status ∈ {Open, In Progress, Closed}` |
| Validation | Only Mongoose built-ins (`required`, `trim`, enum). No custom validators, no email regex, no length limits |
| Indexes | **None declared** — only the implicit `_id_` index |
| Unique constraints | **None** — `email` is not unique |
| Timestamps | `{ timestamps: true }` → `createdAt`, `updatedAt` |
| References / ObjectIds | **None** — every field is scalar |
| Hooks / middleware | **None** (unlike `Notification`, which has a `post("save")` email hook) |
| Virtuals | **None** |
| Computed behavior | **None** — defaults only |

## 2. Complete repository usage inventory

Every reference in the repository (excluding `node_modules`):

**Model / import**

- `backend/src/models/SupportRequest.js` — definition
- `backend/src/controllers/devoteeController.js:11` — `require("../models/SupportRequest")`

**Controller handlers** (`devoteeController.js`)

- `submitSupportRequest` (L1260) — `SupportRequest.create(...)`
- `getSupportRequests` (L1386) — `SupportRequest.find(filter).sort({ createdAt: -1 })`
- `replySupportRequest` (L1397) — `findById(id)` + mutation + `.save()`
- `markSupportRequestAsRead` (L2121) — `findByIdAndUpdate(id, { read: true }, { new: true })`
- exports L2332–2347

**Routes** — `backend/src/routes/devoteeRoutes.js`

- L58 `POST /support` → `submitSupportRequest`
- L59 `GET /support` → `getSupportRequests`
- L60 `PATCH /support/:id` → `replySupportRequest`
- L61 `PATCH /support/:id/read` → `markSupportRequestAsRead`

**Frontend**

- `frontend/src/services/devoteeService.js` — `submitDevoteeSupport`, `getSupportRequests`, `replySupportRequest`, `markSupportRequestAsRead`
- `frontend/src/pages/admin/FeedbackManagement.jsx` — admin "Feedback & Complaints" page
- `frontend/src/pages/admin/NotificationsCenter.jsx` — merges support requests into the notification feed, marks read
- `frontend/src/pages/devotee/DevoteeDashboard.jsx` — devotee submits (L1707) and lists own requests by email (L932, L1718, L4470)
- `frontend/src/App.jsx:154,164` — `/admin/notifications`, `/admin/feedback` (admin-only via `ProtectedRoute`)

**Docs** — `IMPLEMENTATION_GUIDE.md:175-176`, `docs/postgres-migration.md:278`,
`docs/postgres-final-audit-phase-2ac.md:100`, `docs/postgres-prasadam-phase-2z.md:26`

**Not found anywhere:** tests, seed scripts, background jobs, admin utilities,
`backend/scripts/`, `scratch/`, `backend/scratch/`, `backend/src/data/`,
aggregation/populate calls, collection-name references, or any model `ref`.

## 3. Runtime reachability

All four handlers trace end-to-end Route → Controller → Persistence:

| Handler | Route | Persistence | Classification |
|---|---|---|---|
| `submitSupportRequest` | POST `/api/devotee/support` | `create` → Mongoose | **LIVE** |
| `getSupportRequests` | GET `/api/devotee/support` | `find().sort()` → Mongoose | **LIVE** |
| `replySupportRequest` | PATCH `/api/devotee/support/:id` | `findById` + `save()` → Mongoose | **LIVE** |
| `markSupportRequestAsRead` | PATCH `/api/devotee/support/:id/read` | `findByIdAndUpdate` → Mongoose | **LIVE** |

No DEAD, TEST-ONLY, SEED-ONLY or SCRIPT-ONLY usages exist.

## 4. Mounted routes

`devoteeRoutes` is mounted at two prefixes (`backend/src/app.js:59-60`):

- `app.use("/api/devotee", devoteeRoutes)`
- `app.use("/api/devotees", devoteeRoutes)`

Live endpoints (each on both prefixes):

- `POST   /api/devotee|devotees/support`
- `GET    /api/devotee|devotees/support`
- `PATCH  /api/devotee|devotees/support/:id`
- `PATCH  /api/devotee|devotees/support/:id/read`

`devoteeRoutes.js` applies **no auth middleware** — these routes are public.
This mirrors the existing devotee-route pattern but is noted as a security
observation for any future migration phase.

## 5. Existing PostgreSQL overlap

Current schema: 45 tables across migrations 001–032. Candidates checked:

| Candidate | Verdict |
|---|---|
| `notifications` (024) | **Closest but distinct.** A notification is a one-way system message (`title`, `message`, audience identity, `read`/`viewed`, email-dispatch state). A support request is a two-party inquiry with a requester (`name`/`email`), a `subject`, free-text `message`, an admin `reply`, and a 3-state lifecycle. The app *creates a Notification from* a support request (`notificationPersistenceService.create`), proving they are separate records. |
| `tasks` (030) | Distinct — internal staff work items. |
| `repair_requests` / `repair_tickets` (018) | Distinct — asset maintenance with an `assets` FK. |
| `audit_logs` (029) | Distinct — immutable event trail. |
| `users` / `employees` (002) | Distinct — SupportRequest has no FK to either. |
| settings (028), other workflow tables | Distinct. |

**No existing PostgreSQL table semantically represents SupportRequest.** There is
no ticket/helpdesk/feedback table.

## 6. Field-level mapping

| Mongo field | PG equivalent | Semantic equivalence | Missing capability |
|---|---|---|---|
| `_id` | `id TEXT PRIMARY KEY` (24-hex) | Exact (project convention) | — |
| `name` req | `name TEXT NOT NULL` | Exact (+ trimmed non-empty CHECK) | — |
| `email` req | `email TEXT NOT NULL` | Exact; not unique, not lowercased | — |
| `subject` req | `subject TEXT NOT NULL` | Exact | — |
| `message` req | `message TEXT NOT NULL` | Exact | — |
| `reply` opt | `reply TEXT NULL` | Exact | — |
| `status` enum default Open | `status TEXT NOT NULL DEFAULT 'Open'` + CHECK | Exact | — |
| `read` default false | `read BOOLEAN NOT NULL DEFAULT false` | Exact | — |
| `createdAt` | `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` | Exact | — |
| `updatedAt` | `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` | Exact | — |

Absent from the model and therefore **not to be invented**: requester FK, request
type/category, priority, assigned user/employee, comments/history, attachments,
resolution information.

## 7. Relationships / dependencies

- **No inbound references** — no model declares `ref: "SupportRequest"`; no
  `AccountTransaction` source/referenceModel enum names it.
- **No outbound references** — no ObjectIds; linkage to a person is a raw email
  string only.
- **IDs exposed via APIs** — yes; `_id` is the `:id` path param and the frontend
  keys on `req._id` (`NotificationsCenter.jsx:68`). A migration must preserve
  `_id` values as `id`.
- **Document count** — **not discoverable** from the repository.
- **Historical records matter** — yes (admin and devotee history).
- **Independent migration risk** — low coupling; nothing references
  SupportRequest and it references nothing.
- **Outbound runtime dependency** — on create/reply the controller calls the
  already-dual-path `notificationPersistenceService.create(...)`. That call is
  unchanged regardless of where SupportRequest is persisted.

## 8. Mongo behavior

- **Create** — `POST /support` requires `subject` + `message` (400 otherwise);
  `name`/`email` default to `"Anonymous Devotee"` / `"support@devotee.com"`;
  Mongoose enforces required+trim. Returns 201 and creates a Notification.
- **Read** — `GET /support`, optional `?email=` (trimmed + lowercased),
  `sort({ createdAt: -1 })`, no pagination. Returns `{ requests }`.
- **Update (reply)** — `PATCH /support/:id` requires `reply` (400); sets
  `reply`, sets `status` from body only if one of the enum values, **otherwise
  forces `"Closed"`**; creates a Notification; 404 if not found.
- **Update (read)** — sets `read: true` via `findByIdAndUpdate({ new: true })`;
  404 if not found.
- **Delete** — **no delete handler exists at any layer.**
- **Validation** — controller presence checks + Mongoose required/trim/enum; no
  email-format validation.
- **Status transitions** — no state machine; unrecognized values become
  `"Closed"`.
- **Sorting/filtering/pagination** — `createdAt: -1` sort and `email` equality
  filter only; no pagination.
- **Authorization** — none on these routes.
- **Error handling** — try/catch per handler; 400/404/500 with generic messages.

## 9. Data migration implications

- Mongo ObjectIds must be preserved as 24-hex `TEXT` primary keys, matching the
  convention in migrations 018–032.
- `email` is stored as-is (never lowercased) while the GET filter lowercases the
  query — a latent mismatch that should not be silently "fixed" without approval.
- **No foreign keys can be safely introduced** — there is no referenced entity.
  Do not invent an FK to `users`/`employees`.
- No dual writes, backfill or cutover are implied by this audit.

## 10. Recommendation

**OPTION A — migrate `SupportRequest`** in a future, separately approved phase.

It is live and distinct; it is Mongo-only solely because its phase has not been
scheduled.

## 11. Proposed PostgreSQL design (for OPTION A only — NOT implemented)

Table `support_requests`:

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `TEXT` | PK | — | 24-hex Mongo ObjectId |
| `name` | `TEXT` | NOT NULL | — | CHECK non-empty |
| `email` | `TEXT` | NOT NULL | — | CHECK non-empty |
| `subject` | `TEXT` | NOT NULL | — | CHECK non-empty |
| `message` | `TEXT` | NOT NULL | — | CHECK non-empty |
| `reply` | `TEXT` | NULL | — | |
| `status` | `TEXT` | NOT NULL | `'Open'` | CHECK `IN ('Open','In Progress','Closed')` |
| `read` | `BOOLEAN` | NOT NULL | `false` | |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | |

Indexes: PK on `id`; `(created_at DESC)`; optional `(lower(email), created_at DESC)`.
No unique constraints. No foreign keys.

## 12. Proposed migration number

**`033_create_support_requests.sql`** — next free prefix after 030/031/032.
**Not created.**

## 13. Test impact

- **Existing tests exercising SupportRequest: none.**
- Future PG implementation would require: `postgres-support-requests.test.js`
  (CRUD, id round-trip, sort, email filter, enum/required/defaults, `read`
  update), `postgres-support-requests-controllers.test.js` (all four handlers,
  reply status fallback, 400/404 branches), a fallback test, an assertion that
  the outbound `notificationPersistenceService.create` still fires on the PG
  path, and migration-chain assertions in `postgres-migrate.test.js`.

## 14. Files inspected

`backend/src/models/SupportRequest.js`; `backend/src/controllers/devoteeController.js`;
`backend/src/routes/devoteeRoutes.js`; `backend/src/app.js`;
`backend/src/config/db.js`; `backend/src/config/postgres.js`;
`backend/src/services/notificationPersistenceService.js`;
`backend/src/models/Notification.js`; `backend/src/models/Instruction.js`;
`backend/src/models/RepairRequest.js`; `backend/src/db/migrate.js`;
migrations `018`, `024`, `031`, `032` plus the full `CREATE TABLE` inventory
(001–032); `frontend/src/services/devoteeService.js`;
`frontend/src/pages/admin/FeedbackManagement.jsx`;
`frontend/src/pages/admin/NotificationsCenter.jsx`;
`frontend/src/pages/devotee/DevoteeDashboard.jsx`; `frontend/src/App.jsx`;
`IMPLEMENTATION_GUIDE.md`; `docs/postgres-migration.md`;
`docs/postgres-final-audit-phase-2ac.md`; `docs/postgres-prasadam-phase-2z.md`.

## 15. Confirmation

No migration, PostgreSQL table, repository, service, controller, route, model,
datasource or test was created or modified. This document is the only artifact.
