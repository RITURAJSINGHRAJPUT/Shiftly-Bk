# Shiftly

**CRM and intelligent shift management for multi-outlet hospitality.**

Shiftly plans staffing per restaurant. Each outlet runs its own stations, hours
and headcount, so a schedule generated for one venue means nothing at another —
the allocator works from each outlet's own shift patterns, its own people, and
its own coverage targets.

Built for **Bookends Hospitality**: one organization, two brands, six outlets.

```
Bookends Hospitality
├── Capiche ──── PIPLOD · Vesu · Ambli · Uni
└── Aiko ─────── SRT · AHM
```

| | |
|---|---|
| **API** | Express 5 · Prisma 6 · PostgreSQL — `:3001` |
| **Client** | React 18 · Vite · Recharts — `:5173` |
| **Auth** | Stateless JWT in `localStorage`, versioned payload |
| **Styling** | One hand-written stylesheet with a CSS custom-property token layer — no framework |

---

## Contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [How allocation works](#how-allocation-works)
- [Roles and scoping](#roles-and-scoping)
- [Demo logins](#demo-logins)
- [Project layout](#project-layout)
- [Commands](#commands)
- [Documentation](#documentation)
- [What is not built](#what-is-not-built)

---

## Quick start

Requires **Node 20+** and a running **PostgreSQL**.

```bash
npm install        # installs root, server/ and client/
npm run setup      # create DB → push schema → generate client → seed
npm run dev        # API + client together, with a preflight check
```

Then open **http://localhost:5173** and sign in with one of the
[demo logins](#demo-logins) below.

`npm run dev` runs a preflight first (`scripts/preflight.mjs`) so a misconfigured
environment fails with a readable message instead of a stack trace. It stops on
missing `node_modules`, a missing `server/.env` (or one lacking `DATABASE_URL` /
`JWT_SECRET`), and an ungenerated Prisma client — printing the exact command to
fix each — and warns if PostgreSQL is unreachable or ports 3001 / 5173 are
already taken.

Full setup, troubleshooting and environment details: **[RUNNING.md](RUNNING.md)**.

---

## What it does

### Built and working

- **Organization hierarchy** — Organization → Brand → Outlet → Employee, with
  full CRUD and scope filtering at every level.
- **Per-outlet shift patterns** — each outlet defines its own templates
  (department, station, start/end time, required headcount). 42 across the six
  outlets today.
- **Automatic shift allocation** — scores and assigns staff against one outlet's
  patterns for a date range, and reports what it *could not* fill.
- **Geofenced attendance** — check-in validated by Haversine distance against the
  outlet's coordinates and radius; late arrivals flagged at 15 minutes.
- **Leave management** — request, approve and auto-reallocate the affected
  shifts to a replacement.
- **Emergency leave** — requested at least 2 hours ahead, broadcast to eligible
  colleagues at the same outlet with a 30-minute window to volunteer.
- **Dashboards and reports** — headcount, attendance and coverage charts, scoped
  to whatever the signed-in role is allowed to see.
- **Light/dark theming** — resolved before first paint, so the shell never
  flashes the wrong background.
- **A public landing page** at `/` for signed-out visitors.

### Deliberately not built

Five sidebar entries are **stubs**. They render for visual completeness and route
to a page naming exactly what each would need. See
[What is not built](#what-is-not-built).

---

## How allocation works

`autoAllocateShifts(prisma, outletId, startDate, endDate)` reads **that outlet's**
active templates and fills each pattern's `headcount` slots, day by day.

Candidates are the **rosterable roles** — `STAFF`, `HEAD_CHEF` and
`MASTER_OF_HOUSE`. The two managers work shifts and count toward headcount;
`SUPER_ADMIN`, `ADMIN` and `HR` are excluded, or org accounts end up rostered
onto stations.

| Factor | Weight |
|---|---|
| Station skill match | **+30** |
| Historical attendance reliability | +25 |
| Hours balance this week (fewer hours ranks higher) | +20 |
| Availability | +15 |
| 5+ consecutive days worked | −10 per extra day |
| On approved leave | **hard reject** |
| Already working an overlapping shift | **hard reject** |
| Under 8 hours' rest | **hard reject** |

Slots are filled one at a time with a **re-score between each pick**. That is
what prevents double-booking without extra bookkeeping: each assignment enters
the pool, and the scorer already hard-rejects anyone holding an overlapping
shift. Hours-balance and consecutive-day penalties update as the week fills.

It returns `{ count, requested, shifts, shortfalls, outlet }` — **shortfalls are
reported, never hidden**. Each names the pattern, how many were needed, how many
were filled and why. An outlet with no patterns says so rather than falling back
to a generic set.

> With the current demo data each outlet has 3 rosterable people against patterns
> asking for 13–38, so coverage will show large, honest gaps. `npm run seed`
> restores all 191 staff from the CSV for realistic allocation.

---

## Roles and scoping

| Role | Sees |
|---|---|
| `SUPER_ADMIN` | Everything, all outlets |
| `ADMIN` | All outlets |
| `HR` | All outlets, fewer nav items |
| `MASTER_OF_HOUSE` | Own outlet only — floor manager |
| `HEAD_CHEF` | Own outlet only — kitchen manager |
| `STAFF` | Own record and own shifts |

**Every restaurant always has both a Master of House and a Head Chef.** Both are
rostered by auto-allocation.

Scoping is enforced **server-side** in `server/src/lib/scope.js`. Roles outside
the three global ones are pinned to their own outlet, and a query parameter
cannot widen that.

> One trap worth knowing: Prisma **drops a `where` key whose value is
> `undefined`**, so `{ outletId: undefined }` silently returns every outlet's
> rows. `outletScope()` therefore falls back to a match-nothing sentinel rather
> than to `undefined`. Token payloads are versioned so a stale token is rejected
> with a 401 rather than being trusted.

---

## Demo logins

| Role | Email | Password |
|---|---|---|
| Super Admin | `superadmin@shiftly.com` | `admin123` |
| Admin | `admin@shiftly.com` | `admin123` |
| HR | `hr@shiftly.com` | `admin123` |
| Master of House | `moh@shiftly.com` | `admin123` |
| Head Chef | `chef@shiftly.com` | `admin123` |
| Kitchen Staff | `kitchen1@capichep.shiftly.com` | `shiftly123` |

21 accounts in total — 3 organization-level, 12 outlet managers (2 × 6 outlets)
and 6 staff. Other outlets follow the same pattern with their own slug, e.g.
`moh@aikoahm.shiftly.com`. The login screen has one-click buttons for these.

Full credential tables: **[RUNNING.md](RUNNING.md#demo-logins)**.

---

## Project layout

Two independent npm projects. The root `package.json` only delegates to both, so
each keeps its own lockfile and `node_modules` — deliberately **not** npm
workspaces, because hoisting moves Prisma's generated client out from under the
server.

```
Shiftly BK/
├── package.json              root scripts — delegate to server/ and client/
├── scripts/
│   ├── preflight.mjs         env checks before `npm run dev`
│   └── build-brand-assets.py generates every logo/icon from assets/
├── assets/                   brand artwork + the seed CSV
│
├── server/                                                        → :3001
│   ├── prisma/schema.prisma  Organization·Brand·Outlet·Employee·Shift·…
│   └── src/
│       ├── index.js          app + route mounts
│       ├── db.js             one shared PrismaClient
│       ├── middleware/       auth.js — JWT + role guards
│       ├── lib/              scope.js (permissions) · dates.js (local-midnight)
│       ├── routes/           11 routers
│       ├── engine/           shiftAllocator · geoAttendance · leaveManager
│       │                     · emergencyLeave
│       └── scripts/          createDb · seedFromCSV · seedShiftTemplates
│                             · ensureOutletManagers · seedDemoStaff
│
└── client/                                                        → :5173
    ├── public/brand/         generated logo + icon set
    └── src/
        ├── App.jsx           ThemeProvider → AuthProvider → Router → Scope → Layout
        ├── api/client.js     fetch wrapper + token handling
        ├── contexts/         Auth · Theme · Scope
        ├── components/       Sidebar · Header · BrandLogo · MobileNav · …
        ├── pages/            Dashboard · Shifts · Employees · Attendance · …
        └── index.css         the whole design system, token layer first
```

---

## Commands

All from the project root.

| Command | Does |
|---|---|
| `npm install` | Installs root, `server/` and `client/` |
| `npm run dev` | **Preflight, then API + client together** |
| `npm run setup` | Create DB → push schema → generate client → seed |
| `npm run build` | Production build to `client/dist/` |
| `npm start` | Serve the production build + API |
| `npm run seed` | Re-seed. **Wipes and rebuilds all rows** |
| `npm run managers` | Create any missing outlet managers — idempotent, additive |
| `npm run seed:staff` | Create the demo staff account per outlet — idempotent |
| `npm run seed:templates` | Re-seed shift patterns |
| `npm run db:studio` | Browse the database in a GUI on `:5555` |
| `npm run check` | Run the preflight checks alone |
| `npm run ports:free` | Kill whatever holds `:3001` / `:5173` |

The seed scripts split deliberately: `npm run seed` is destructive, while
`managers` and `seed:staff` only ever add what is missing, so they are safe
against live data.

---

## Documentation

| Document | Covers |
|---|---|
| **[RUNNING.md](RUNNING.md)** | Prerequisites, first-time setup, day-to-day running, every demo credential, brand assets, troubleshooting |
| **[DOCS.md](DOCS.md)** | Architecture, full data model, scoping rules, complete API reference, the engines, client structure, design system, conventions and traps |
| `implementation_plan.md` | The original build plan. Historical — trust the two above where they disagree |

---

## What is not built

Stated plainly so the gaps are visible rather than discovered later.

**No data model exists for:** labour cost (there is no wage or hourly-rate field
anywhere), transfer requests, leave balances or accrual, announcements, audit
logs, employee documents, attendance corrections, or break in/out.

**Five sidebar items are stubs** — AI Planner, Transfers, Analytics, Audit Logs
and Users. Each routes to a page naming what it would require.

**Also absent:**

- The six role-specific dashboard variants — there are two branches, management
  and staff.
- `BAR` and `CLEANING` departments. The enum has `KITCHEN`, `SERVICE` and
  `HOUSEKEEPING`, and the source CSV contains no bar staff.
- **Any test suite.** Verification to date is manual plus scripted Puppeteer
  runs.
- Emergency-leave auto-assign automation — nothing schedules it, so a lapsed
  window stays `COVERAGE_PENDING` until a manager acts.
- Rate limiting on login, `helmet`, and request-body schema validation beyond the
  hand-rolled checks in the shift-template router.
- **A registered service worker.** `client/public/sw.js` exists but nothing calls
  `navigator.serviceWorker.register()`, so there is no offline support or push
  despite the PWA manifest.

**Known open bugs:**

- `hasTimeOverlap` in the allocator does not handle a shift whose end time is
  before its start, so **overnight shifts are not detected as overlapping**.
- `findBestReplacement` in `leaveManager.js` filters by outlet but **not by
  department**, so approving a chef's leave can hand a kitchen station to a
  housekeeper.

---

## Notes for contributors

A few conventions that are easy to violate by accident:

- **Dates are stored at local midnight.** `new Date('2026-07-27')` parses as
  *UTC* midnight, which lands before local midnight in IST and silently drops the
  first day of any range. Always use the helpers in `server/src/lib/dates.js`.
- **The RESPONSIVE block must stay last** in `client/src/index.css`. Several
  rules there tie on specificity with utility classes, and source order is what
  resolves them.
- **Recharts needs real colour values**, not `var(--token)`. It maps `stroke` and
  `fill` onto SVG attributes where `var()` does not resolve, and reads them back
  in JS for legends and tooltips.
- **Brand assets are generated.** Never hand-edit anything in
  `client/public/brand/` — change `assets/newshiftly.png` and re-run
  `python3 scripts/build-brand-assets.py`.

More of these, with the incident behind each, in
[DOCS.md § Conventions and traps](DOCS.md#conventions-and-traps).
