# Running Bookends Shiftly

```bash
npm install     # installs root + server + client
npm run setup   # create database, push schema                  (first time only)
npm run dev     # starts the API and the web client together
```

Create the one account that exists, and note the password it prints:

```bash
npm --prefix server run reset:superadmin
```

Then open **http://localhost:57935**, sign in as `superadmin@shiftly.com` with that
password, and choose your own when asked. Everybody else is enrolled from the
Employees page.

To put it online, see **[DEPLOY.md](DEPLOY.md)** — one Render service serving both
the app and the API, with Supabase for Postgres.

For architecture, the data model, the API reference and the conventions to know
before extending the code, see **[DOCS.md](DOCS.md)**.

Everything runs from the **project root**. `server/` and `client/` stay independent
projects with their own lockfiles — the root `package.json` just delegates to
both, so Prisma's generated client is never hoisted out from under the server.

```
Shiftly BK/
├── package.json   root scripts — run everything from here
├── scripts/       preflight + port helpers
├── server/        Express 5 + Prisma 6 + PostgreSQL   → http://localhost:3001
├── client/        React 18 + Vite                     → http://localhost:57935
└── assets/        Shiftly Shift Shift - Sheet1.csv    (the seed data source)
```

`npm run dev` runs a preflight first. It fails fast with an actionable message if
dependencies or `server/.env` are missing, and warns (without blocking) if
PostgreSQL is unreachable or a port is already taken.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node 20+** | Verified on v24.14.1 |
| **PostgreSQL 14+**, running locally | Verified on 16.14 (Homebrew). Must be listening on `127.0.0.1:5432` |

Check Postgres is up before anything else:

```bash
pg_isready -h 127.0.0.1 -p 5432
# 127.0.0.1:5432 - accepting connections
```

If it isn't: `brew services start postgresql@16` (macOS/Homebrew).

---

## First-time setup

### 1. Create `server/.env`

This file is gitignored, so a fresh clone won't have it:

```bash
cat > server/.env <<'EOF'
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/shiftly?schema=public"
JWT_SECRET="change-me-to-something-random"
PORT=3001
EOF
```

> **Heads-up:** [`server/src/scripts/createDb.js`](server/src/scripts/createDb.js#L14-L17)
> hardcodes `user: 'postgres'` / `password: '799020'` for the *database-creation*
> step only. If your local Postgres uses different credentials, either edit those
> four lines or create the database yourself and skip that script:
> ```bash
> createdb shiftly
> ```

### 2. Install dependencies

One command from the root — a `postinstall` hook installs `server/` and
`client/` for you:

```bash
npm install
```

### 3. Build the database and seed it

```bash
npm run setup
```

`setup` chains four steps: create the database → push the Prisma schema →
generate the Prisma client → seed from the CSV.

Expect roughly:

```
✅ Bookends Hospitality
✅ Capiche, Aiko                     (2 brands)
✅ 6 outlets
   Total employees: 196
   Total shifts: 783
   Total attendance: 444
```

---

## Running day to day

One command, one terminal:

```bash
npm run dev
```

Output is prefixed per service, and `Ctrl+C` stops both:

```
✓ preflight ok — starting api on :3001 and web on :57935
[api] 🚀 Bookends Shiftly listening on port 3001
[web]   ➜  Local:   http://localhost:57935/
[api] POST /login 200 121ms
```

The API restarts on save via `node --watch`; the client hot-reloads via Vite.

If you'd rather run them separately — useful when you want to restart just one —
`npm run dev:api` and `npm run dev:web` do exactly that.

Then open **http://localhost:57935**.

| Service | URL |
|---|---|
| Web client | http://localhost:57935 |
| API | http://localhost:3001 |
| API health check | http://localhost:3001/api/health |
| Prisma Studio (DB browser) | `cd server && npm run db:studio` → http://localhost:5555 |

The API's CORS allow-list is `localhost:57935` and `localhost:3000`
([index.js:21](server/src/index.js#L21)). Serving the client from any other
origin means adding it there.

---

## Accounts

There are no shared or default passwords, and no quick-login buttons.

| | |
|---|---|
| **Create the first account** | `npm --prefix server run reset:superadmin` — deletes every employee and their shifts, attendance, leave and notifications; keeps organisations, brands, outlets and station lists; prints a generated password once |
| **Enrol someone** | Employees → Add. Saving generates a one-time password, shown once |
| **Someone lost theirs** | The key icon on their row issues a new one-time password |
| **Change your own** | Settings → Your Password |
| **Lock someone out** | Deactivate them — the login handler refuses an inactive account |

**Who can do what: [ACCESS.md](ACCESS.md)** — a role-by-action table generated
from the same declaration the route guards enforce, so it cannot describe
permissions the server does not have. Regenerate with
`npm --prefix server run access:doc`; add `--users` to list who currently holds
each role.

A new account can reach nothing until it sets its own password: its token carries
a `pwreset` claim and every other endpoint refuses it with
`403 PASSWORD_RESET_REQUIRED`. That restriction lives in the signed token, not in
the UI, so it cannot be skipped by avoiding the screen.

Minimum length 10, no composition rules; passwords containing your email address
or an obvious choice are refused. Failed sign-ins are rate limited to 20 per
15 minutes per IP — successful ones do not count, so a shift change where
everybody signs in at once never trips it.

`JWT_SECRET` has no fallback. The API refuses to start without it rather than
signing tokens with a predictable value.

### Demo data

`npm run seed`, `seed:staff` and `managers` create accounts whose passwords are
written down in this repository. They refuse to run unless you opt in:

```bash
ALLOW_DEMO_SEED=true npm --prefix server run seed:staff
```

Never point them at anything real. `seed` is destructive, and all three would put
known passwords back into the database.

Outlet slugs, which those scripts use: `capichep` · `capichev` · `capichea` ·
`capicheu` · `aikosrt` · `aikoahm`.

That makes **21 accounts in total**: 3 organization-level, 12 outlet managers
(2 × 6 outlets) and 6 staff — one obvious login per role.

> A full `npm run seed` instead imports all 191 staff from the CSV, with
> addresses of the form `<firstname>@<outlet>.shiftly.com`.

The login page also has one-click buttons for the management accounts, which
fill both fields for you.

Roles outside Super Admin / Admin / HR are **pinned server-side to their own
outlet** — the top-bar scope selectors render disabled for them, and a query
parameter cannot widen the scope.

---

## Command reference

All from the project root.

| Command | Does |
|---|---|
| `npm install` | Installs root, `server/` and `client/` |
| `npm run dev` | **Preflight, then API + client together** |
| `npm run dev:api` | API only, with `--watch` |
| `npm run dev:web` | Client only |
| `npm run setup` | Create DB → push schema → generate client → seed |
| `npm run seed` | Re-seed only. **Wipes and rebuilds all rows** |
| `npm run managers` | Create any missing outlet managers. Idempotent, additive — safe on live data. `--dry-run` to preview |
| `npm run seed:staff` | Create 1 demo staff account per outlet. Idempotent, additive. `--dry-run` to preview |
| `npm run build` | Production build to `client/dist/` |
| `npm start` | Serve the production build + API (no watch/HMR) |
| `npm run db:push` | Sync `schema.prisma` to the database |
| `npm run db:generate` | Regenerate the Prisma client after a schema edit |
| `npm run db:studio` | Browse/edit the database in a GUI on :5555 |
| `npm run check` | Run the preflight checks on their own |
| `npm run ports:free` | Kill whatever is holding :3001 / :57935 (macOS/Linux) |

The per-project scripts still exist if you prefer them — `cd server && npm run dev`
and so on work exactly as before.

A clean production build looks like:

```
dist/assets/index-*.js       ~133 kB │ gzip:  33 kB   app code
dist/assets/react-*.js       ~164 kB │ gzip:  53 kB   react + router
dist/assets/recharts-*.js    ~422 kB │ gzip: 120 kB   charts
dist/assets/index-*.css       ~36 kB │ gzip:   7 kB
```

Recharts and React are split into their own chunks so they stay cached across
deploys instead of being re-downloaded whenever app code changes.

---

## Brand assets

The logo is the cutlery-built SHIFTLY wordmark. The single source of truth is
`assets/newshiftly.png`; everything the app serves is derived from it into
`client/public/brand/` by:

```bash
python3 scripts/build-brand-assets.py     # needs Pillow
```

**Those outputs are committed, so you never need to run this to work on the app.**
Re-run it only if `assets/newshiftly.png` itself changes — and commit the
results, including `client/src/components/brand-metrics.json`, which the script
also writes so `BrandLogo` can reserve the right box before the image decodes.

Nothing about the artwork is hardcoded: the crop, the leading-S boundary and the
emitted dimensions are all measured. Swapping the source to a differently
proportioned drawing needs no code edit beyond the `SOURCE` path.

It produces two things beyond a straight resize, both for reasons worth knowing
before editing any of it:

- **`-light` variants.** The artwork is near-black navy with cream highlights.
  That is ideal on white and nearly invisible on the navy sidebar or a dark-mode
  card, so the script derives a lightness-inverted copy for dark surfaces.
  `client/src/components/BrandLogo.jsx` chooses between them — pass `onDark` for
  a surface that is dark in *both* themes, like the sidebar.
- **Plated icons.** Used bare, the fork-`S` glyph thins into an illegible
  squiggle below about 48px. Every favicon and PWA icon therefore sits on a navy
  rounded plate. In-app chips keep the indigo `--sidebar-active-bg` instead — a
  navy plate would disappear against the navy sidebar.

`assets/logo.png` holds the fuller "Bookends Hospitality" lockup. Nothing uses it
at present; its second line is unreadable at nav and sidebar sizes.

---

## Troubleshooting

**Login says "Session outdated — please sign in again"**
Expected once, right after pulling this work. The JWT payload was versioned when
`venueId` became `outletId`, so tokens issued before the change are rejected
rather than silently granted the wrong scope. Sign in again.

**`Error: P1001 Can't reach database server`**
Postgres isn't running. `pg_isready -h 127.0.0.1 -p 5432` to confirm, then
`brew services start postgresql@16`.

**`prisma db push` refuses: "Added the required column … There are N rows"**
Prisma can't add a required column to a table that already has rows. On a
development database:

```bash
cd server
npx prisma db push --force-reset   # DESTROYS ALL DATA
npm run seed
```

Never run `--force-reset` against anything you can't reproduce from the CSV.

**Port already in use / API returns stale behaviour**
A previous run is still holding :3001. It will keep serving old code and ignore
your edits. The preflight warns about this; to clear it:

```bash
npm run ports:free
```

**Dashboard KPIs all read 0**
Check the API directly:

```bash
curl -s localhost:3001/api/health
```

If that fails the client is fine and the API is down. If it succeeds, open the
browser console — a failed `/api/dashboard/*` call will be visible there.

**Check-in button says "Acquiring location coordinates"**
Geolocation needs permission and a secure context. `localhost` counts as secure,
so it works in dev, but the browser still has to be granted location access —
allow it when prompted. Deploying anywhere other than localhost requires HTTPS.
Check-in also validates against the outlet's geofence, so a real device far from
the seeded Surat/Ahmedabad coordinates records as *Out of range* (still logged,
just flagged). Adjust coordinates under **Settings → Location Geofences**.

**Employee list looks short**
The top-bar Organization / Brand / Outlet selectors filter server-side. Reset
them to "All …" to see all 196.

---

## Notes on the data

Everything is generated from
[`assets/Shiftly Shift Shift - Sheet1.csv`](assets/Shiftly%20Shift%20Shift%20-%20Sheet1.csv)
and is disposable — `npm run seed` rebuilds it at any time.

Real seeded totals: **1 organization, 2 brands, 6 outlets, 196 employees,
783 shifts, 444 attendance records.** Shifts are generated for the current
Mon–Sun week, and attendance only for days that have already passed, so the
attendance-trend chart is legitimately empty before this Monday.

Some screens are deliberately unfinished because no data backs them. **AI
Workforce Planner, Transfer Recommendations, Analytics, Audit Logs** and **User
Management** appear in the sidebar (marked *Soon*) and land on a page that states
what each would require. Labour cost and transfer-request figures are omitted
from the dashboard for the same reason rather than shown as invented numbers.
