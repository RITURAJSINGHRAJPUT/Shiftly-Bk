# API reference

Every endpoint in Bookends Shiftly — 65 across 15 routers. Express 5 + Prisma +
PostgreSQL, mounted under `/api`.

For the public integration API in detail, see **[PUBLIC_API.md](PUBLIC_API.md)**.
For who may do what, see **[ACCESS.md](../ACCESS.md)** (generated from
`server/src/lib/capabilities.js`). For architecture, see **[DOCS.md](../DOCS.md)**.

---

## Contents

- [Conventions](#conventions)
- [Auth](#auth) · [Health](#health)
- [Organizations](#organizations) · [Brands](#brands) · [Outlets](#outlets)
- [Employees](#employees)
- [Shifts](#shifts) · [Shift patterns](#shift-patterns)
- [Attendance](#attendance)
- [Leave](#leave) · [Transfers](#transfers)
- [Notifications](#notifications) · [Dashboard](#dashboard) · [Audit log](#audit-log)
- [Public API](#public-api)
- [Endpoint index](#endpoint-index)

---

## Conventions

### Authentication

Two schemes, and only two.

| | Header | Used by |
|---|---|---|
| **JWT bearer** | `Authorization: Bearer <token>` | Everything except the three below |
| **API key** | `X-API-Key: <key>` | `/api/public/*` only |

Exactly three endpoints need neither: `POST /api/auth/login`, `GET /api/health`,
and `GET /api/public/staff` (which needs a key instead).

Tokens come from `POST /api/auth/login`, last **7 days**, and carry
`{ v, id, role, outletId }`. `v` is a token version — bumping `TOKEN_VERSION` in
`server/src/middleware/auth.js` invalidates every issued token, and a mismatch
returns **401** so the client clears it rather than looping.

**No database read happens on authentication.** Role and outlet come from the
token, so a role change does not take effect until the user signs in again.

### Password-reset tokens

An account with `mustChangePassword: true` gets a restricted token (`pwreset`,
1 hour). Every guarded endpoint rejects it with **403**
`{ code: 'PASSWORD_RESET_REQUIRED' }`. Only two accept it: `GET /api/auth/me`
and `POST /api/auth/change-password` — enough to display the set-password
screen and complete it, and nothing else.

### Roles

Ranked. Each capability names the lowest rank that may perform it, and every
role above it inherits.

| Rank | Role | Scope |
|---|---|---|
| 6 | `SUPER_ADMIN` | Whole organisation |
| 5 | `ADMIN` | Whole organisation |
| 4 | `HR` | Whole organisation |
| 4 | `OUTLET_MANAGER` | One outlet |
| 3 | `MASTER_OF_HOUSE` | One outlet |
| 2 | `HEAD_CHEF` | One outlet |
| 1 | `STAFF` | Themselves |

`SUPER_ADMIN`, `ADMIN` and `HR` have **global scope** — no outlet, no
department. Everyone else is pinned to `outletId`.

`OUTLET_MANAGER` sits at rank 4 but is not global: several endpoints use
`canOrOutletManager(...)`, which lets a manager past a higher floor **for their
own outlet only**, enforced by an ownership check inside the handler.

### Scoping

Most list endpoints accept three cascading filters:

| Param | Effect |
|---|---|
| `?org=<id>` | Everything under one organization |
| `?brand=<id>` | Everything under one brand |
| `?outlet=<id>` | One outlet |

**A non-global role cannot widen scope with these.** `outletScope()`
(`server/src/lib/scope.js`) replaces the requested scope with the caller's own
outlet rather than combining them. A user with no resolvable outlet matches a
sentinel that can never equal a uuid, so the query returns nothing instead of
everything.

### Errors

```json
{ "error": "Human-readable message" }
```

| Code | Meaning |
|---|---|
| `400` | Validation failure, or a duplicate on a unique field |
| `401` | Missing/invalid/expired token, or wrong credentials |
| `403` | Authenticated but not permitted — wrong role, or another outlet |
| `404` | No such row, or no such endpoint |
| `429` | Rate limited |
| `500` | Unhandled — most routers return the raw error message |
| `503` | Database unreachable, or public API not configured |

**Caveat:** most handlers end `catch (err) { res.status(500).json({ error: err.message }) }`,
which returns raw Prisma text to the client. Only `/api/audit-logs` and
`/api/public/*` return a generic message.

### Rate limits

| Limiter | Window | Limit | Applies to |
|---|---|---|---|
| `apiLimiter` | 60s | 600 | All of `/api`, keyed by IP |
| `loginLimiter` | 15 min | 20 | `login` + `change-password`, **failures only** |
| `publicApiLimiter` | 60s | 60 | `/api/public/*`, keyed by API key |

`RATE_LIMIT_DISABLED=true` turns all three off. Never set it where real traffic
is served.

### Dates

Date-only strings are `YYYY-MM-DD` and resolved to **local** day bounds, not
UTC. `new Date('2026-07-27')` is UTC midnight, which sorts after a row stored at
local midnight east of UTC — that dropped the first day of every range. See
`server/src/lib/dates.js`.

---

## Auth

`/api/auth`

### `POST /login`

Public. Rate limited to 20 failures / 15 min.

```json
{ "email": "chef@example.com", "password": "..." }
```

→ `{ token, mustChangePassword, user: { id, name, email, role, department, outletId, outlet, avatar } }`

Every failure returns the same **401** `Invalid email or password` — wrong
email, wrong password, and deactivated account are indistinguishable, so this
cannot be used to enumerate accounts. A deactivated account cannot log in even
with the right password.

### `POST /change-password`

Accepts a reset token. Serves both the forced first change and a voluntary one.

```json
{ "currentPassword": "...", "newPassword": "..." }
```

→ `{ token, mustChangePassword: false }` — a **fresh** token, since the old one
may have been a restricted reset token.

Rules (`server/src/lib/passwords.js`): minimum **10 characters**, not on the
obvious-password denylist, not derived from the email, and different from the
current one.

### `GET /me`

Accepts a reset token. Returns `id, name, email, role, department, outletId,
outlet, avatar, phone, skills, mustChangePassword`. No operational data — only
who is signed in.

---

## Health

### `GET /api/health`

Public. Runs `SELECT 1`.

→ **200** `{ status: 'ok', database: 'connected', timestamp }`
→ **503** `{ status: 'error', database: 'unreachable', error }`

Deliberately able to fail. A health check that cannot report ill health is
decoration — this one catches a deployment pointed at the wrong `DATABASE_URL`.

---

## Organizations

`/api/organizations` · the top of the hierarchy: **Organization → Brand → Outlet → Employee**

| Method | Path | Guard |
|---|---|---|
| `GET` | `/` | any |
| `POST` | `/` | `ADMIN` |
| `PUT` | `/:id` | `ADMIN` |

`GET /` returns a bare array of active organizations, each with its active
brands and an outlet count per brand.

`POST /` takes `{ name }` → **201**. `PUT /:id` takes `{ name?, isActive? }`.
A duplicate name is **400**, not 500.

> `POST` exists because without it an empty database is unusable: `Brand.organizationId`
> is required, so no organization means no brand, no outlet, and no employee.

---

## Brands

`/api/brands`

| Method | Path | Guard |
|---|---|---|
| `GET` | `/?org=` | any |
| `POST` | `/` | `ADMIN` |
| `PUT` | `/:id` | `ADMIN` |

`GET /` returns active brands with `organization` and `_count.outlets`. A
non-global role sees only brands that own their outlet.

`POST /` requires `{ name, organizationId }`.

`PUT /:id` takes `{ name?, organizationId?, isActive?, stations? }`.

**`stations`** is the brand's list of kitchen stations and the row order of its
shift grid. Order is preserved; entries are trimmed and de-duplicated
case-insensitively, because two rows differing only by case read as one station
and would save as two.

---

## Outlets

`/api/outlets`

| Method | Path | Guard |
|---|---|---|
| `GET` | `/?org=&brand=` | any |
| `POST` | `/` | `ADMIN` |
| `PUT` | `/:id` | `ADMIN`, or `OUTLET_MANAGER` for their own |

`GET /` returns a bare array. Each outlet carries its `brand` (including
`stations`), `_count.employees`, plus two derived fields:

```json
{
  "managers": { "MASTER_OF_HOUSE": { "id", "name", "email", "role" }, "HEAD_CHEF": null },
  "missingManagers": ["HEAD_CHEF"]
}
```

Every restaurant is expected to have one of each, so the gap is reported rather
than left for the client to work out.

`POST /` requires `{ name, brandId }`, optionally `address, latitude, longitude,
radius`. Defaults: `21.17, 72.83, 100`.

`PUT /:id` additionally validates **latitude** −90…90, **longitude** −180…180,
**radius** 10…10000 metres.

> `PUT` is ADMIN-guarded because it moves the geofence, and anyone who can move
> it can defeat attendance validation. An `OUTLET_MANAGER` may edit only their
> own outlet — enforced inside the handler, not just by the role floor.

---

## Employees

`/api/employees` · `Employee` is also the auth record; there is no separate User model.

| Method | Path | Guard |
|---|---|---|
| `GET` | `/` | any |
| `GET` | `/:id` | any |
| `POST` | `/` | `HR` |
| `PUT` | `/:id` | `HR` |
| `POST` | `/:id/reset-password` | `ADMIN`, or `OUTLET_MANAGER` for their own outlet |
| `DELETE` | `/:id` | `ADMIN`, or `OUTLET_MANAGER` for their own outlet |
| `GET` | `/stats/overview` | any |
| `GET` | `/stats/wipe-preview` | `SUPER_ADMIN` |
| `POST` | `/wipe-staff` | `SUPER_ADMIN` |

### `GET /`

Query: `org`, `brand`, `outlet`, `department`, `role`, `search`, `page` (1),
`limit` (50). `search` matches name or email, case-insensitive. Active only.

→ `{ employees: [...], total, page, limit }`

`limit` is **not clamped** here — unlike `/api/audit-logs`, which caps at 100.

### `GET /:id`

Full record plus the last 20 shifts, 30 attendance rows and 10 leaves.

> ⚠️ This handler applies **no outlet scope**. Any authenticated user, including
> `STAFF`, can read any employee by id — including `phone` and `employeeCode`.

### `POST /`

`{ name, email, role?, department?, outletId?, phone?, skills? }`.
`name` and `email` are required; `role` defaults to `STAFF`.

→ **201** with the employee **plus `temporaryPassword`**.

The password is generated server-side and returned exactly **once** — what is
stored is a bcrypt hash, so it cannot be looked up again. The account is created
with `mustChangePassword: true`.

Assignment rules, applied identically on create and update:

- A management role (`SUPER_ADMIN`/`ADMIN`/`HR`) **clears** `outletId`,
  `department` and `skills` — a promotion must not leave the old outlet behind,
  still counting against that restaurant's headcount.
- Any other role **requires** `outletId`.
- `skills` (kitchen stations) are lowercased, de-duplicated, and **dropped for
  non-kitchen staff** — the allocator compares `skills.includes(section.toLowerCase())`,
  so a capitalised value stores fine and then silently never matches.
- `HR` cannot assign management roles → **403**.
- `OUTLET_MANAGER` can only touch their own outlet, and cannot assign
  `OUTLET_MANAGER` or any management role → **403**.

### `PUT /:id`

Partial. Same fields plus `isActive`. Judged against the **effective** role: a
request changing only the role still moves the assignment with it.

### `POST /:id/reset-password`

→ `{ id, name, email, temporaryPassword }`. Re-arms `mustChangePassword`.

> This is the one privileged action that writes **no audit log**.

### `DELETE /:id`

Soft — sets `isActive: false`, which is a real lockout since login refuses
inactive accounts. Not a hard delete: that would erase shift, attendance and
leave history, retroactively changing dashboard numbers for weeks that already
happened.

### `GET /stats/overview`

→ `{ total, active, byDepartment, byOutlet }` (the last two are Prisma
`groupBy` results).

### `GET /stats/wipe-preview` and `POST /wipe-staff`

Bulk delete, `SUPER_ADMIN` only. Preview returns what would go:
`{ employees, shifts, attendance, leaves, notifications, keeping }`.

The wipe requires a typed phrase:

```json
{ "confirm": "DELETE ALL STAFF" }
```

Scope is **`STAFF` only, excluding the caller**. Deleting everyone would remove
the caller's own row while their JWT stayed valid, so every later request would
500 and nobody could sign back in without terminal access. It also preserves the
rule that each outlet has a Master of House and a Head Chef.

Runs in one transaction, children first — no relation in the schema declares
`onDelete`, so every foreign key defaults to `Restrict`.

> `POST`, not `DELETE`, because the client's `delete()` sends no body and this
> needs the confirmation phrase.

---

## Shifts

`/api/shifts`

| Method | Path | Guard |
|---|---|---|
| `GET` | `/` | any |
| `GET` | `/my/upcoming` | any |
| `POST` | `/` | `HEAD_CHEF` |
| `POST` | `/auto-allocate` | `HEAD_CHEF` |
| `PUT` | `/:id` | `HEAD_CHEF` |
| `DELETE` | `/:id` | `ADMIN`, or `OUTLET_MANAGER` for their own outlet |

`GET /` — query `org`, `brand`, `outlet`, `date`, `startDate`+`endDate`,
`employee`, `status`. Returns a bare array with `employee` and `outlet`
attached, ordered by date then start time.

`GET /my/upcoming` — the caller's next 14 `ASSIGNED` shifts from today.

`POST /` — `{ date, startTime, endTime, section?, employeeId, outletId? }`.
`outletId` defaults to the caller's. Creates a `SHIFT_ASSIGNED` notification for
the employee. A `section` on a non-kitchen employee is **400**: stations are a
kitchen concept, and one on a service shift is dead data that still paints a tag
on the week grid.

`POST /auto-allocate` — `{ outletId?, startDate, endDate }`, runs
`server/src/engine/shiftAllocator.js`.

`PUT /:id` — partial: `date, startTime, endTime, section, employeeId, status`.

**On every write**, a locked role must own the outlet. `outletId` arrives in the
request body and is not trusted: without the check, a head chef could create or
edit shifts at another restaurant by supplying its id.

---

## Shift patterns

`/api/shift-templates` · the weekly template the allocator expands into shifts

| Method | Path | Guard |
|---|---|---|
| `GET` | `/?outlet=&activeOnly=` | any |
| `GET` | `/clear-preview?outlet=` | `HEAD_CHEF` |
| `POST` | `/` | `HEAD_CHEF` |
| `POST` | `/bulk` | `HEAD_CHEF` |
| `POST` | `/clear` | `HEAD_CHEF` |
| `PUT` | `/grid` | `HEAD_CHEF` |
| `PUT` | `/:id` | `HEAD_CHEF` |
| `DELETE` | `/:id` | `HEAD_CHEF` |

### Body and validation

Shared by every write (`readTemplateBody`):

| Field | Rule |
|---|---|
| `name` | required on create, non-empty |
| `department` | `KITCHEN` · `SERVICE` · `HOUSEKEEPING` |
| `section` | station; **KITCHEN only**, `""` means general (stored `null`) |
| `startTime` `endTime` | `HH:MM`, 24-hour |
| `headcount` | integer 1–99, default 1 |
| `slot` | integer 1–6 — shift rows a station runs |
| `daysOfWeek` | array of 0–6, **Sunday = 0**, at least one |
| `isActive` | boolean |

`daysOfWeek` matches `Date.getDay()` so neither the allocator nor the week grid
has to convert. A pattern running on no day would sit in the list looking active
while the allocator skipped it every day — hence the non-empty rule.

Changing `department` away from `KITCHEN` clears any station left behind.

### `POST /bulk`

One pattern, created at many outlets: `{ outletIds: [...], ...template }`.
All-or-nothing in a transaction.

There is no unique constraint on `(outletId, name)`, so a name already present
at an outlet is **skipped, not duplicated** — re-running "apply to all outlets"
after adding a restaurant is safe.

→ `{ created: [...], skipped: [{ id, name, reason }] }` — **201** if anything
was created, **200** if everything was skipped.

### `PUT /grid`

Replaces a whole week for one or more outlets: `{ outletIds, templates }`.
Shift Master edits a grid, so it saves as a grid — a half-applied week is worse
than either outcome.

Every row is validated **before** anything is deleted. **Inactive patterns are
kept**: one parked on purpose is absent from the grid, so deleting it here would
be silent data loss.

→ `{ replaced, created, keptInactive, outlets }`

### `POST /clear` and `GET /clear-preview`

```json
{ "outletId": "...", "confirm": "CLEAR PATTERNS", "includeShifts": false }
```

Shifts are **opt-in**. `Shift` has no foreign key to `ShiftTemplate`, so
clearing patterns orphans nothing at the database level — but destroying a
roster on a button labelled "clear patterns" would be a surprise.

→ `{ patterns, shifts }`

Every write checks outlet ownership, and `/bulk` and `/grid` check **every id**,
not just the first.

---

## Attendance

`/api/attendance` · geofenced check-in, `server/src/engine/geoAttendance.js`

| Method | Path | Guard |
|---|---|---|
| `POST` | `/check-in` | any (self) |
| `POST` | `/check-out` | any (self) |
| `GET` | `/today` | any (self) |
| `GET` | `/` | any (scoped) |
| `GET` | `/stats` | any (scoped) |

`POST /check-in` and `/check-out` take `{ latitude, longitude }`. Missing
coordinates → **400**. The engine compares the position against the outlet's
`latitude`/`longitude`/`radius`; outside it, or the wrong time, and the check-in
is refused — errors surface as **400** with the engine's message.

`GET /today` returns the caller's row, or `{ status: 'NOT_CHECKED_IN' }`.

`GET /` — query `date`, `startDate`+`endDate`, `employee`, `status`. Capped at
**200 rows**, newest first.

> Only `SUPER_ADMIN`, `ADMIN`, `HR` and `MASTER_OF_HOUSE` see anyone else's
> attendance. Every other role — including `HEAD_CHEF` and `OUTLET_MANAGER` — is
> forced to `employeeId = self`.

`GET /stats` → `{ checkedIn, late, absent, total, present, notCheckedIn }` for
today. `present` counts `LATE`: someone who turned up late still turned up.

---

## Leave

`/api/leaves`

| Method | Path | Guard |
|---|---|---|
| `GET` | `/` | any (scoped) |
| `GET` | `/stats` | any (scoped) |
| `GET` | `/emergency/pending` | any (scoped) |
| `POST` | `/` | any (self) |
| `POST` | `/emergency` | any (self) |
| `POST` | `/emergency/:leaveId/accept` | any (self) |
| `POST` | `/:id/approve` | `HEAD_CHEF` + department rule |
| `POST` | `/:id/reject` | `HEAD_CHEF` + department rule |
| `POST` | `/emergency/:leaveId/auto-assign` | `HEAD_CHEF` + department rule |

`GET /` — query `status`, `employee`, `type`, `startDate`, `endDate`. Capped at
100. `STAFF` always sees only their own.

`POST /` — `{ type, startDate, endDate, reason }`. Rejects a start after the
end, a date in the past, and any overlap with an existing `PENDING`/`APPROVED`
leave.

### Who may approve

Beyond the `HEAD_CHEF` floor, a department rule applies:

| Caller | May act on |
|---|---|
| `SUPER_ADMIN` / `ADMIN` / `HR` | Anything |
| `OUTLET_MANAGER` | Any department, **own outlet only** |
| `MASTER_OF_HOUSE` | `SERVICE` + `HOUSEKEEPING`, own outlet |
| `HEAD_CHEF` | `KITCHEN`, own outlet |

`POST /:id/reject` takes `{ reason }`.

### Emergency leave

`POST /emergency` takes `{ reason }` and puts the leave into
`COVERAGE_PENDING`, notifying eligible colleagues.

`POST /emergency/:leaveId/accept` — a volunteer takes the shift.

`POST /emergency/:leaveId/auto-assign` — assigns the best-scoring available
employee. **404** if already handled or nobody is eligible.

`GET /emergency/pending` is outlet-scoped: it drives the "volunteer to cover"
action, so it must only show requests the caller could actually cover.

`GET /stats` → `{ pending, approved, emergency, total }`.

---

## Transfers

`/api/transfers` · an employee moving outlet, or changing station

| Method | Path | Guard |
|---|---|---|
| `GET` | `/?outlet=&status=&type=` | any (scoped) |
| `POST` | `/` | any (self) |
| `POST` | `/:id/approve` | `HEAD_CHEF`, outlet on either side |
| `POST` | `/:id/reject` | `HEAD_CHEF`, outlet on either side |
| `POST` | `/:id/cancel` | the requester only |

`POST /` — `{ type, targetOutletId?, targetDepartment?, targetSkills?, reason? }`.
`type` is `OUTLET` or `STATION`. Only operational staff may request one, and
only one may be `PENDING` at a time.

A locked manager may act on a transfer touching their outlet on **either side** —
both the losing and the gaining restaurant have a legitimate interest in the
move.

`POST /:id/cancel` works only on your own request, and only while `PENDING`.

`GET /` is capped at 100. `STAFF` sees only their own; a locked manager sees
their outlet's incoming and outgoing plus their own.

---

## Notifications

`/api/notifications` · always the caller's own; there is no way to read another's

| Method | Path | |
|---|---|---|
| `GET` | `/?unreadOnly=true` | Last 50, newest first |
| `GET` | `/count` | `{ count }` of unread |
| `PUT` | `/:id/read` | Mark one read |
| `PUT` | `/read-all` | Mark all read |

`GET /count` is excluded from the request log — the client polls it.

> `PUT /:id/read` takes the id from the URL without checking ownership, so a
> caller who knows another user's notification id can mark it read. It returns
> the row, which leaks its content.

---

## Dashboard

`/api/dashboard` · all scoped, all read-only

### `GET /stats`

→ `{ totalEmployees, totalBrands, totalOutlets, todayShifts, todayAttendance,
attendanceRate, pendingLeaves, emergencyLeaves, weekShifts }`

For a locked user, `totalBrands`/`totalOutlets` report whether their **own**
outlet is active — not a count across an organisation they cannot see.

### `GET /attendance-trend?days=7`

`days` clamped 1–31. → `{ series: [{ date, attendance, scheduled, present }], target: 95 }`

Rate is present / scheduled, `LATE` counted as present. `attendance` is `null`
on a day with nothing scheduled — not `0`, which would draw a crash on the chart.

### `GET /brand-performance`

Current week's attendance rate per brand →
`[{ brand, attendance, scheduled, present }]`. A locked user's row counts only
their own outlet, not sibling outlets under the same brand.

### `GET /department-staffing?day=tomorrow`

`day` is `today` or `tomorrow` (default). → `{ date, total, byDepartment }`.

> Real scheduled shifts, not a forecast. This is the honest version of the
> mockup's "AI Staffing Prediction" panel — there is no prediction engine.

---

## Audit log

### `GET /api/audit-logs` — `ADMIN`

Query `page` (1), `limit` (50, **capped at 100**), `action`, `actor` (substring,
case-insensitive), `entity`, `from`, `to`. `to` extends to end-of-day.

→ `{ logs, total, page, limit, pages }`

Actions recorded: `LOGIN`, `LOGIN_FAILED`, `PASSWORD_CHANGE`, `EMPLOYEE_CREATE`,
`EMPLOYEE_EDIT`, `EMPLOYEE_DEACTIVATE`, `STAFF_WIPE`, `ORGANIZATION_*`,
`BRAND_*`, `OUTLET_CREATE`, `OUTLET_EDIT`, `SHIFT_CREATE`, `SHIFT_DELETE`,
`SHIFT_ALLOCATE`, `PATTERN_CREATE`, `PATTERN_CLEAR`, `LEAVE_APPROVE`,
`LEAVE_REJECT`, `TRANSFER_*`.

Writes are fire-and-forget and never awaited: a failed audit write must not fail
the action it describes. The only privileged action **not** logged is
`POST /api/employees/:id/reset-password`.

---

## Public API

### `GET /api/public/staff` — `X-API-Key`

The only endpoint outside the JWT. Staff grouped by outlet, for consumers
outside Shiftly. Query: `org`, `brand`, `outlet`, `department`, `role`,
`includeInactive`.

Fields are an **allowlist**, not a list of exclusions: no email, phone, avatar,
password, or outlet geofence. `SUPER_ADMIN`, `ADMIN` and `HR` are excluded by
role.

Returns **503** when `PUBLIC_API_KEYS` is unset — an unconfigured deployment
fails closed.

Full reference: **[PUBLIC_API.md](PUBLIC_API.md)**.

---

## Endpoint index

| # | Method | Path | Guard |
|---|---|---|---|
| 1 | `POST` | `/api/auth/login` | public |
| 2 | `POST` | `/api/auth/change-password` | reset token ok |
| 3 | `GET` | `/api/auth/me` | reset token ok |
| 4 | `GET` | `/api/health` | public |
| 5 | `GET` | `/api/organizations` | any |
| 6 | `POST` | `/api/organizations` | `ADMIN` |
| 7 | `PUT` | `/api/organizations/:id` | `ADMIN` |
| 8 | `GET` | `/api/brands` | any |
| 9 | `POST` | `/api/brands` | `ADMIN` |
| 10 | `PUT` | `/api/brands/:id` | `ADMIN` |
| 11 | `GET` | `/api/outlets` | any |
| 12 | `POST` | `/api/outlets` | `ADMIN` |
| 13 | `PUT` | `/api/outlets/:id` | `ADMIN` / own outlet |
| 14 | `GET` | `/api/employees` | any |
| 15 | `GET` | `/api/employees/:id` | any |
| 16 | `POST` | `/api/employees` | `HR` |
| 17 | `PUT` | `/api/employees/:id` | `HR` |
| 18 | `POST` | `/api/employees/:id/reset-password` | `ADMIN` / own outlet |
| 19 | `DELETE` | `/api/employees/:id` | `ADMIN` / own outlet |
| 20 | `GET` | `/api/employees/stats/overview` | any |
| 21 | `GET` | `/api/employees/stats/wipe-preview` | `SUPER_ADMIN` |
| 22 | `POST` | `/api/employees/wipe-staff` | `SUPER_ADMIN` |
| 23 | `GET` | `/api/shifts` | any |
| 24 | `POST` | `/api/shifts` | `HEAD_CHEF` |
| 25 | `POST` | `/api/shifts/auto-allocate` | `HEAD_CHEF` |
| 26 | `PUT` | `/api/shifts/:id` | `HEAD_CHEF` |
| 27 | `DELETE` | `/api/shifts/:id` | `ADMIN` / own outlet |
| 28 | `GET` | `/api/shifts/my/upcoming` | any |
| 29 | `GET` | `/api/shift-templates` | any |
| 30 | `GET` | `/api/shift-templates/clear-preview` | `HEAD_CHEF` |
| 31 | `POST` | `/api/shift-templates` | `HEAD_CHEF` |
| 32 | `POST` | `/api/shift-templates/bulk` | `HEAD_CHEF` |
| 33 | `POST` | `/api/shift-templates/clear` | `HEAD_CHEF` |
| 34 | `PUT` | `/api/shift-templates/grid` | `HEAD_CHEF` |
| 35 | `PUT` | `/api/shift-templates/:id` | `HEAD_CHEF` |
| 36 | `DELETE` | `/api/shift-templates/:id` | `HEAD_CHEF` |
| 37 | `POST` | `/api/attendance/check-in` | any (self) |
| 38 | `POST` | `/api/attendance/check-out` | any (self) |
| 39 | `GET` | `/api/attendance/today` | any (self) |
| 40 | `GET` | `/api/attendance` | viewer roles |
| 41 | `GET` | `/api/attendance/stats` | any |
| 42 | `GET` | `/api/leaves` | any |
| 43 | `POST` | `/api/leaves` | any (self) |
| 44 | `POST` | `/api/leaves/:id/approve` | `HEAD_CHEF` + dept |
| 45 | `POST` | `/api/leaves/:id/reject` | `HEAD_CHEF` + dept |
| 46 | `POST` | `/api/leaves/emergency` | any (self) |
| 47 | `POST` | `/api/leaves/emergency/:leaveId/accept` | any (self) |
| 48 | `POST` | `/api/leaves/emergency/:leaveId/auto-assign` | `HEAD_CHEF` + dept |
| 49 | `GET` | `/api/leaves/emergency/pending` | any |
| 50 | `GET` | `/api/leaves/stats` | any |
| 51 | `GET` | `/api/transfers` | any |
| 52 | `POST` | `/api/transfers` | any (self) |
| 53 | `POST` | `/api/transfers/:id/approve` | `HEAD_CHEF` |
| 54 | `POST` | `/api/transfers/:id/reject` | `HEAD_CHEF` |
| 55 | `POST` | `/api/transfers/:id/cancel` | requester |
| 56 | `GET` | `/api/notifications` | any (self) |
| 57 | `GET` | `/api/notifications/count` | any (self) |
| 58 | `PUT` | `/api/notifications/:id/read` | any |
| 59 | `PUT` | `/api/notifications/read-all` | any (self) |
| 60 | `GET` | `/api/dashboard/stats` | any |
| 61 | `GET` | `/api/dashboard/attendance-trend` | any |
| 62 | `GET` | `/api/dashboard/brand-performance` | any |
| 63 | `GET` | `/api/dashboard/department-staffing` | any |
| 64 | `GET` | `/api/audit-logs` | `ADMIN` |
| 65 | `GET` | `/api/public/staff` | `X-API-Key` |

---

## Not built

No `GET /api/outlets/:id`, no `DELETE` for outlets, brands or organizations
(deactivate with `PUT { isActive: false }`). No refresh tokens — a 7-day token
expires and the user logs in again. No webhooks, no CSV export endpoint (the CSV
parser at `server/src/engine/csvShiftParser.js` is used by scripts only). No
versioning — there is one client and one server, deployed together.
