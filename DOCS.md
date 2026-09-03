# Bookends Shiftly — Technical Documentation

CRM and shift management for multi-outlet hospitality. Express + Prisma +
PostgreSQL API, React PWA client.

For install and run instructions see **[RUNNING.md](RUNNING.md)**. For the
complete endpoint-by-endpoint API reference see **[API.md](api/API.md)**.

---

## Contents

- [Architecture](#architecture)
- [Data model](#data-model)
- [Scoping and permissions](#scoping-and-permissions)
- [API reference](#api-reference)
- [The engines](#the-engines)
- [Client structure](#client-structure)
- [Design system](#design-system)
- [Conventions and traps](#conventions-and-traps)
- [What is not built](#what-is-not-built)

---

## Architecture

Two independent npm projects. The root `package.json` only delegates to both, so
each keeps its own lockfile and `node_modules` — deliberately not npm workspaces,
because hoisting would move Prisma's generated client out from under the server.

```
Shiftly BK/
├── package.json          root scripts (dev, setup, seed…)
├── scripts/preflight.mjs runs before `npm run dev`
├── server/               Express 5 · Prisma 6 · PostgreSQL   → :3001
│   ├── prisma/schema.prisma
│   └── src/
│       ├── index.js      app + route mounts
│       ├── db.js         single shared PrismaClient
│       ├── middleware/   auth.js — JWT, role guards
│       ├── lib/          scope.js, dates.js
│       ├── routes/       11 routers
│       ├── engine/       allocator, geo-attendance, leave, emergency leave
│       └── scripts/      createDb, seedFromCSV, seedShiftTemplates
├── client/               React 18 · Vite · Recharts           → :57935
└── assets/               Shiftly Shift Shift - Sheet1.csv  (seed source)
```

**Client dependencies:** react 18.3, react-dom, react-router-dom 6.26,
date-fns 4.4, lucide-react 0.435, recharts 3.10. No CSS framework — one
hand-written stylesheet with a token layer.

Auth is a stateless JWT in `localStorage`, sent as `Authorization: Bearer`.

---

## Data model

```
Organization ──< Brand ──< Outlet ──< Employee ──< Shift
                             │                 ──< Attendance
                             ├──< Shift        ──< Leave
                             └──< ShiftTemplate ──< Notification
```

Current seeded scale: **1 organization → 2 brands → 6 outlets → 196 employees**,
42 shift templates, ~850 shifts, 444 attendance rows.

### Enums

| Enum | Values |
|---|---|
| `Role` | `SUPER_ADMIN` `ADMIN` `HR` `MASTER_OF_HOUSE` `HEAD_CHEF` `STAFF` |
| `Department` | `KITCHEN` `SERVICE` `HOUSEKEEPING` |
| `ShiftStatus` | `ASSIGNED` `COMPLETED` `MISSED` `SWAPPED` `CANCELLED` |
| `AttendanceStatus` | `CHECKED_IN` `CHECKED_OUT` `ABSENT` `LATE` `ON_LEAVE` |
| `LeaveType` | `CASUAL` `SICK` `EARNED` `EMERGENCY` `UNPAID` |
| `LeaveStatus` | `PENDING` `APPROVED` `REJECTED` `CANCELLED` `COVERAGE_PENDING` |
| `NotificationType` | 9 values — shift assigned/changed, emergency cover request/accepted/auto-assigned, leave approved/rejected, attendance reminder, general |

### Key models

**`Outlet`** — one restaurant. Carries the geofence used by attendance:
`latitude`, `longitude`, `radius` (metres, default 100).

**`Employee`** — `role`, `department`, `outletId`, and `skills String[]`. The
skills array is what the allocator's station matching keys off, e.g.
`["pizza","pasta"]`.

Two role tiers share this table:

- **Organization-level** — `SUPER_ADMIN`, `ADMIN`, `HR`. One of each. They carry
  an `outletId` only because `Employee` owns the login; their scope is global
  (see `GLOBAL_SCOPE_ROLES`). They are **not** rosterable.
- **Outlet-level** — `MASTER_OF_HOUSE` and `HEAD_CHEF`. **Every restaurant always
  has one of each**, and both are working managers, so they belong to their
  outlet and are part of its staffing pool. `STAFF` likewise.

`npm run managers` creates any missing outlet managers; it is idempotent and
additive, so it is safe against a live database.

**`ShiftTemplate`** — a recurring staffing *requirement* at one outlet:

| Field | Purpose |
|---|---|
| `outletId` | Patterns are per restaurant, not global |
| `department` | Which pool can fill it |
| `section` | Station — `Pizza`, `Pasta`… `null` means general |
| `startTime` / `endTime` | Wall-clock strings, `"12:00"` |
| `headcount` | **How many people it needs** |
| `isActive` | Excluded from allocation when false |

**`Shift`** — one actual assignment: `date`, `startTime`, `endTime`, `section`,
`status`, `employeeId`, `outletId`.

**`Attendance`** — `@@unique([employeeId, date])`, so one row per person per day,
upserted by check-in. Holds `checkIn`/`checkOut` plus the lat/lng of each and
`withinRange`.

**`Leave`** — includes `isEmergency`, `coveredById` and `expiresAt`, which drive
the 30-minute emergency-cover window.

The full schema is [server/prisma/schema.prisma](server/prisma/schema.prisma).

---

## Scoping and permissions

Every list endpoint is scoped through [server/src/lib/scope.js](server/src/lib/scope.js).

`GLOBAL_SCOPE_ROLES` = `SUPER_ADMIN`, `ADMIN`, `HR`. Those three may filter with
`?org=`, `?brand=` or `?outlet=`. **Every other role is pinned server-side to its
own outlet and a query parameter cannot widen that** — the pin is applied instead
of, not alongside, the request.

```js
outletScope(req)    // models with outletId: Employee, Shift
employeeScope(req)  // models reached via employee: Attendance, Leave
```

Brand and org are not columns; they resolve through `Outlet`, so they become
nested relation filters.

`outletScope` returns a match-nothing sentinel when a locked role has no
resolvable outlet. This matters: `where: { outletId: undefined }` makes Prisma
**drop the filter entirely** and return every outlet's rows, so the failure mode
without it is a silent privilege escalation rather than an error.

### Role guards

`requireMinRole(role)` uses a numeric hierarchy in
[middleware/auth.js](server/src/middleware/auth.js) — `SUPER_ADMIN` 6 down to
`STAFF` 1.

| Action | Minimum role |
|---|---|
| Create / edit employee | `HR` |
| Deactivate employee, delete shift, edit outlet/brand/org | `ADMIN` |
| Create shift, auto-allocate, approve/reject leave, manage shift patterns | `HEAD_CHEF` |
| View attendance beyond your own | `MASTER_OF_HOUSE` |

### Token versioning

The JWT payload carries `v: 2`. Tokens below the current version are rejected
with **401**, not 403 — the client only clears a dead token on 401, so a 403 here
would leave it in place and silently fail every request.

This exists because renaming the `venueId` claim to `outletId` would otherwise
leave old tokens resolving to `undefined`, which as noted above means *no filter*.

---

## API reference

> **Every endpoint, in full — parameters, bodies, responses and guards — is in
> [API.md](api/API.md).** What follows is the summary; where the two disagree,
> API.md is the one checked against the routers.

All routes require `Authorization: Bearer <token>` except `POST /api/auth/login`,
`GET /api/health`, and the key-gated public API — see
**[PUBLIC_API.md](api/PUBLIC_API.md)**.

### Auth
| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | `{ email, password }` → `{ token, user }` |
| `GET` | `/api/auth/me` | Current user with outlet → brand → organization |

### Hierarchy
| Method | Path | Guard |
|---|---|---|
| `GET` | `/api/organizations` | — |
| `PUT` | `/api/organizations/:id` | ADMIN |
| `GET` | `/api/brands?org=` | — |
| `POST` `PUT` | `/api/brands` `/api/brands/:id` | ADMIN |
| `GET` | `/api/outlets?org=&brand=` | — |
| `POST` `PUT` | `/api/outlets` `/api/outlets/:id` | ADMIN |

`PUT /api/outlets/:id` validates latitude, longitude and radius ranges. It is
ADMIN-guarded because it moves the geofence, and anyone who can move it can
defeat attendance validation.

### Employees
| Method | Path | Guard |
|---|---|---|
| `GET` | `/api/employees?org=&brand=&outlet=&department=&role=&search=&page=&limit=` | — |
| `GET` | `/api/employees/:id` | — |
| `POST` `PUT` | `/api/employees` `/api/employees/:id` | HR |
| `DELETE` | `/api/employees/:id` | ADMIN (soft — sets `isActive false`) |
| `GET` | `/api/employees/stats/overview` | — |

Passwords are never returned; every handler strips the field.

### Public integration API
| Method | Path | Guard |
|---|---|---|
| `GET` | `/api/public/staff?org=&brand=&outlet=&department=&role=&includeInactive=` | `X-API-Key` |

Staff grouped by outlet, for consumers outside Shiftly. No JWT — the key comes
from `PUBLIC_API_KEYS`, and with that unset the endpoint answers 503 rather than
opening up. Fields are an allowlist: no email, phone, or geofence, and
`SUPER_ADMIN` / `ADMIN` / `HR` accounts are excluded by role. Full reference in
**[PUBLIC_API.md](api/PUBLIC_API.md)**.

### Shifts and patterns
| Method | Path | Guard |
|---|---|---|
| `GET` | `/api/shifts?outlet=&date=&startDate=&endDate=&employee=&status=` | — |
| `POST` | `/api/shifts` | HEAD_CHEF |
| `POST` | `/api/shifts/auto-allocate` | HEAD_CHEF |
| `PUT` | `/api/shifts/:id` | HEAD_CHEF |
| `DELETE` | `/api/shifts/:id` | ADMIN |
| `GET` | `/api/shifts/my/upcoming` | — (own shifts, next 14) |
| `GET` | `/api/shift-templates?outlet=&activeOnly=` | — |
| `POST` `PUT` `DELETE` | `/api/shift-templates[/:id]` | HEAD_CHEF |

Shift-template writes additionally verify the target `outletId` against the
caller's scope, so a head chef cannot create a pattern for another restaurant.
`headcount` is validated as an integer 1–99 and times as `HH:MM`.

### Attendance
| Method | Path |
|---|---|
| `POST` | `/api/attendance/check-in` — `{ latitude, longitude }` |
| `POST` | `/api/attendance/check-out` |
| `GET` | `/api/attendance/today` |
| `GET` | `/api/attendance?date=&startDate=&endDate=&employee=&status=` |
| `GET` | `/api/attendance/stats` |

### Leave
| Method | Path | Guard |
|---|---|---|
| `GET` | `/api/leaves?status=&employee=&type=` | — |
| `POST` | `/api/leaves` | — |
| `POST` | `/api/leaves/:id/approve` · `/reject` | HEAD_CHEF |
| `POST` | `/api/leaves/emergency` | — |
| `POST` | `/api/leaves/emergency/:leaveId/accept` | — |
| `POST` | `/api/leaves/emergency/:leaveId/auto-assign` | HEAD_CHEF |
| `GET` | `/api/leaves/emergency/pending` · `/api/leaves/stats` | — |

### Dashboard aggregates
| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/dashboard/stats` | Employee/brand/outlet counts, today's attendance rate, pending and emergency leave, week shifts |
| `GET` | `/api/dashboard/attendance-trend?days=` | Per-day attendance % plus target |
| `GET` | `/api/dashboard/brand-performance` | Attendance % by brand this week |
| `GET` | `/api/dashboard/department-staffing?day=today\|tomorrow` | Scheduled headcount per department |

### Notifications
`GET /api/notifications`, `GET /api/notifications/count`,
`PUT /api/notifications/:id/read`, `PUT /api/notifications/read-all`.

---

## The engines

### Shift allocation — [engine/shiftAllocator.js](server/src/engine/shiftAllocator.js)

`autoAllocateShifts(prisma, outletId, startDate, endDate)` reads **that outlet's**
active templates and, for each day and pattern, fills `headcount` slots.

Candidates come from `ROSTERABLE_ROLES` = `STAFF`, `HEAD_CHEF`,
`MASTER_OF_HOUSE`. The two managers work shifts and count toward headcount;
`SUPER_ADMIN`, `ADMIN` and `HR` are excluded. Without that filter the allocator
rostered org accounts onto stations — `superadmin@` was given a Drinks shift.

`scoreEmployee` ranks candidates:

| Factor | Weight |
|---|---|
| Station skill match | +30 |
| Historical attendance reliability | +25 |
| Hours balance this week (fewer = higher) | +20 |
| Availability | +15 |
| 5+ consecutive days | −10 per extra day |
| On approved leave | **hard reject** |
| Already working an overlapping shift | **hard reject** |
| Under 8 hours' rest | **hard reject** |

Slots are filled one at a time with a **re-score between each**. That is what
prevents double-booking without extra bookkeeping: each pick is pushed into the
candidate pool, and `scoreEmployee` already hard-rejects anyone holding an
overlapping shift. Hours-balance and consecutive-day penalties also update as the
week fills.

Returns `{ count, requested, shifts, shortfalls[], outlet }`. Shortfalls list
every slot group that could not be filled, with a reason — under-staffing is
reported, not hidden. An outlet with no patterns returns an explicit message
rather than falling back to a generic set.

### Geofenced attendance — [engine/geoAttendance.js](server/src/engine/geoAttendance.js)

Haversine distance from the outlet's coordinates; `withinRange` is
`distance <= outlet.radius`. Check-in is marked `LATE` when more than 15 minutes
after the shift start. Out-of-range check-ins are **recorded and flagged**, not
rejected.

### Leave — [engine/leaveManager.js](server/src/engine/leaveManager.js)

Approving a leave reallocates the affected shifts to a replacement chosen by
workload and skill, and notifies them.

### Emergency leave — [engine/emergencyLeave.js](server/src/engine/emergencyLeave.js)

Must be requested ≥2 hours before the shift. Creates the leave as
`COVERAGE_PENDING`, broadcasts to eligible same-department colleagues at the same
outlet, and sets a 30-minute `expiresAt`. A volunteer accepting reassigns the
shift; `autoAssignEmergency` picks the lightest workload.

> **Not automated.** Nothing schedules `autoAssignEmergency` — no cron, no timer.
> When the 30-minute window lapses the leave stays `COVERAGE_PENDING` unless a
> manager triggers auto-assign manually.

---

## Client structure

```
src/
├── App.jsx              ThemeProvider → AuthProvider → Router → ScopeProvider → Layout
├── constants.js         MOBILE_BREAKPOINT, ROLES, GLOBAL_SCOPE_ROLES
├── api/client.js        fetch wrapper, token handling
├── contexts/            AuthContext · ThemeContext · ScopeContext
├── hooks/               useMediaQuery · useChart
├── theme/chartPalette.js
├── components/          Sidebar Header Modal StatTile ChartCard Segmented
│                        Switch MobileNav CountdownTimer + charts/
└── pages/               Dashboard Employees Shifts Attendance Leaves Reports
                         Settings Organizations Brands Outlets Login Stub
                         mobile/MobileProfile
```

### Contexts

- **`ThemeContext`** — light/dark, persisted, `data-theme` on `<html>`.
  Initialises **from the DOM**, not localStorage, because an inline script in
  `index.html` has already resolved the theme before first paint; reading it back
  guarantees React's first render agrees with what is on screen.
- **`ScopeContext`** — org/brand/outlet selection. Derives the whole tree from a
  single `GET /outlets`, since each outlet already carries its brand and org.
  Renders disabled for roles the server pins to one outlet.
- **`AuthContext`** — user, login, logout, `loading`. `loading` must be honoured
  before redirecting, or a refresh bounces a valid session to `/login`.

### Shift Planning page

Reads top-to-bottom as **patterns → today → the week**:

1. **Shift Patterns** — that outlet's requirements, editable
2. **Daily coverage** — the selected day grouped under the pattern each shift
   fills, showing `filled/needed` and who is on, plus a "not covered by a
   pattern" bucket for ad-hoc shifts
3. **Weekly** — the 7-column grid

Outlet tabs switch restaurant. The daily and weekly sections navigate
independently. Clicking a tab deliberately does **not** rewrite global scope,
which would silently re-filter Employees, Attendance and Reports.

---

## Design system

One stylesheet, [client/src/index.css](client/src/index.css), built on CSS custom
properties.

- **Light default**, dark via `:root[data-theme="dark"]`.
- **Surfaces** `--surface-page|card|sunken|raised|input`, **ink**
  `--ink-strong|base|muted|faint`, **lines** `--line-subtle|default|strong`.
  Ink values are contrast-checked: muted is the AA floor for body text; `faint`
  is for icons and dividers only, never text.
- **The sidebar has its own `--sidebar-*` set that is never redeclared in the
  dark block**, so it stays navy in both themes. Nothing inside `.sidebar` may
  reference `--surface-*` or `--ink-*`, or it inverts against its own background.
- `--space-1..12` on a 4px base; `--content-max: none` so content fills the
  width beside the sidebar (set a length to reintroduce a ceiling).
- Charts: series colours live in
  [theme/chartPalette.js](client/src/theme/chartPalette.js) as **JS**, not CSS
  variables — Recharts maps `stroke`/`fill` to SVG *attributes* where `var()`
  does not resolve, and it also reads those values in JS for legend swatches and
  tooltip dots. Chart chrome (grid, axis, ticks, fonts) is styled in CSS.

---

## Conventions and traps

These are the things most likely to bite when extending the code.

### Dates are local midnight

`Shift.date` and `Attendance.date` are written at **local** midnight and stored
as `timestamp without time zone`. Always bound range queries with the helpers in
[lib/dates.js](server/src/lib/dates.js):

```js
localDateRange(startDate, endDate)   // { gte, lt }
startOfLocalDay(value)
localDateKey(date)                   // YYYY-MM-DD from local parts
```

`new Date('2026-07-27')` parses as **UTC** midnight, which is *after* a row
written at local midnight anywhere east of UTC. Used as a `gte` bound it silently
drops the first day of the range — a week view showed six days and reported the
seventh as empty. Equally, never build a date key with `toISOString()`; it shifts
the day backwards at positive offsets.

### Wall-clock times are strings

`startTime` / `endTime` are `String` (`"12:00"`) because they are recurring
times, not instants. Comparisons convert to minutes.

> **Open bug:** `hasTimeOverlap` does not handle `end < start`, so an overnight
> shift like `16:00–01:00` is evaluated as `960 < 60` and its conflicts go
> undetected. Two seeded patterns cross midnight, so this is live.

### `where: { field: undefined }` removes the filter

Prisma drops undefined keys. For anything security-relevant, use a
match-nothing sentinel instead of relying on a value being present — see
`outletScope`.

### CSS ordering

The responsive block is deliberately the **last** thing in `index.css`. It shares
specificity with the utility classes, so placed earlier the utilities win and the
mobile overrides silently do nothing.

### Flex items need `min-width: 0`

`.main-content` is a flex item; without `min-width: 0` it grows to its content's
min-content width, which defeats `.table-container`'s own `overflow-x: auto` and
makes the whole page scroll sideways. The same applies to Recharts'
`ResponsiveContainer`.

### Prisma client

Import the shared instance from [server/src/db.js](server/src/db.js). Each route
file used to construct its own, opening one connection pool per file.

---

## What is not built

Stated plainly so the gaps are visible rather than discovered later.

**No data model exists for:** labour cost (no wage or hourly-rate field
anywhere), transfer requests, leave balances/accrual, announcements, audit logs,
employee documents, attendance corrections, or break in/out.

**Five sidebar items are stubs** — AI Workforce Planner, Transfer
Recommendations, Analytics, Audit Logs, User Management. They render for visual
fidelity and route to a page that names what each would require.

**Also absent:**

- The six role-specific dashboard variants; there are two branches, management
  and staff.
- `BAR` and `CLEANING` departments — the enum has `KITCHEN`, `SERVICE`,
  `HOUSEKEEPING`, and the source CSV contains no bar staff.
- Any test suite. Verification to date has been manual plus scripted Puppeteer
  runs.
- Emergency-leave auto-assign automation (see above).
- Rate limiting on login, `helmet`, and request-body schema validation beyond the
  hand-rolled checks in the shift-template router.
- A registered service worker. `public/sw.js` exists but nothing registers it, so
  there is no offline support or push despite the PWA manifest.

**Known open bugs:** the overnight-shift overlap gap described above, and
`findBestReplacement` in `leaveManager.js` filters by outlet but **not**
department, so approving a chef's leave can hand a kitchen station to a
housekeeper.
