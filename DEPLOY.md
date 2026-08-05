# Putting Bookends Shiftly live

One Render **Web Service** serving both the app and the API, with Supabase for
Postgres. About 30 minutes.

Everything runs from **one URL**. The client is built into `client/dist` and
served by the same Express process that answers `/api`, so there is no second
service, no CORS to configure and no second thing to keep in step.

The guide is in two phases, deliberately in this order:

- **[Phase A](#phase-a--the-database)** builds the database from your laptop. No
  Render involved, and it ends with a checkpoint.
- **[Phase B](#phase-b--the-web-service)** deploys. By then the database is known
  good, so anything that goes wrong is the host and only the host.

Doing it the other way round couples the two: the schema would only exist once
Render's build succeeded, so a build failure would surface later as a confusing
"table does not exist" and you would be debugging two things at once.

---

## Before you start

**You need:** a [Supabase](https://supabase.com) account, a
[Render](https://dashboard.render.com) account, this repository on GitHub, and
Node 20+ locally.

**Rotate the Supabase `service_role` key.** It was visible in a screenshot during
development. It grants full read and write to your database on its own, bypassing
every rule in this app. Bookends Shiftly never uses it — Prisma connects with the
Postgres connection string — so rotating costs you nothing.

> Supabase → Project Settings → API → `service_role` → **Reset**

**Never set `RATE_LIMIT_DISABLED` on Render.** It exists so local test runs can
sign in dozens of times without tripping the limiter. On a live instance that
limiter is what stands between your data and someone guessing passwords.

---

# Phase A · The database

Everything here runs from your own machine against Supabase. Nothing needs Render
to exist yet.

## A1 · Create the project and take the connection string

1. Supabase → **New project**. Choose a region near you and set a database
   password.
2. Once it is provisioned: **Connect** → **Session pooler**.
3. Copy the string and replace `[YOUR-PASSWORD]` with the password you set:

   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
   ```

> **Session pooler, not the direct connection.** Render's instances get new IP
> addresses, and the direct connection is IPv6-only on the free Supabase tier —
> which fails from Render with a confusing `P1001 Can't reach database server`.
> The pooler is IPv4 and is what Supabase recommends here.

You will paste this string into four commands below and once into Render. It is a
password in a URL — treat it as one. Everywhere below, `<POOLER-URL>` means it.

## A2 · Create the tables

```bash
DATABASE_URL='<POOLER-URL>' npm --prefix server run db:push
```

You should see:

```
🚀  Your database is now in sync with your Prisma schema.
```

This is declarative and idempotent — running it again on an unchanged schema just
says "already in sync". Render's build runs it too, which is why that later run
costs nothing.

> `P1001 Can't reach database server` here means the string is wrong, or it is
> the direct connection rather than the pooler. Fix it now; every step below
> uses the same string.

## A3 · Copy your restaurants across

`db push` creates tables, not rows. This copies the organisation, brands
(including each brand's station list) and outlets from the database you built
them in — by default the one in `server/.env`.

Look first:

```bash
TARGET_DATABASE_URL='<POOLER-URL>' \
  npm --prefix server run migrate:structure -- --dry-run
```

Then write:

```bash
TARGET_DATABASE_URL='<POOLER-URL>' \
  npm --prefix server run migrate:structure
```

It preserves ids, so running it twice updates the same rows instead of making a
second copy of everything.

**People are deliberately not copied.** Employee rows carry password hashes and,
in a database you have developed against, test accounts. You create the real ones
in A4 and through the app.

> **Starting fresh instead?** Skip this. The super admin can create an
> organisation from the **Organizations** page, then brands and outlets under it,
> so the whole hierarchy can be built in the app.

## A4 · Create the super admin

```bash
DATABASE_URL='<POOLER-URL>' npm --prefix server run reset:superadmin
```

```
Done. One account remains:

  email     superadmin@shiftly.com
  password  xxxx-xxxx-xxxx
```

**Write that password down now.** It is shown once — only a bcrypt hash is
stored — and you will be asked to replace it the first time you sign in.

This talks to Postgres directly and needs no running server, which is why it
works on the free tier where there is no Shell tab.

> It deletes every employee before creating the one. On a database you have just
> created that is nothing; on a live one it would be everything. It is a
> first-run command, not a password reset — for that, use the key icon on the
> person's row in **Employees**.

## A5 · Checkpoint

Three things must be true before Render is worth involving. Two you have already
seen; the third takes a moment.

**1 · The tables exist.** A2 printed `Your database is now in sync`.

**2 · Your restaurants are there.** A3 printed the target's own counts:

```
  target now holds:
      1 organisations · 3 brands · 7 outlets · 0 employees
```

Those numbers come from querying Supabase after writing, not from the source, so
they are the real answer.

**3 · One account exists and you have its password.** A4 printed it, once.

To see it for yourself: Supabase → **Table Editor** → `Organization`, `Brand`,
`Outlet`, `Employee`. `Brand` should show your `stations` arrays, and `Employee`
exactly one row with `mustChangePassword` set to true.

If all three hold, the database is finished and correct. Anything that goes wrong
from here is Render, and only Render.

---

# Phase B · The Web Service

Bookends Shiftly is a **Web Service** — Render's type for a long-running process
that listens on a port. No other type can host it: a **Static Site** serves files
with no Node process behind them, so `/api` would have nowhere to go; a **Private
Service** has no public URL; a **Background Worker** has no HTTP listener.

## B1 · Push to GitHub

```bash
git add -A
git commit -m "Deployment configuration"
git push origin main
```

Nothing secret goes with it: `.env` and `dist/` are gitignored, and
[`render.yaml`](render.yaml) names `DATABASE_URL` without containing it.

## B2 · Create the service

[dashboard.render.com](https://dashboard.render.com) → **New** → **Web Service**
→ connect this repository, then:

| Field | Value |
|---|---|
| Language | **Node** |
| Branch | `main` |
| Region | Singapore (closest of Render's to Surat) |
| Root Directory | *leave empty* — the build runs from the repository root |
| Build Command | `npm install && npm run build:deploy` |
| Start Command | `npm start` |
| Instance Type | **Free** — switch to Starter when you go live |
| Health Check Path | `/api/health` — under **Advanced** |

Then **Environment** → add two variables:

| Key | Value |
|---|---|
| `DATABASE_URL` | `<POOLER-URL>` |
| `JWT_SECRET` | click **Generate** |

**Create Web Service.**

> **The two commands are where the previous attempt failed.** A start command of
> `npm run dev` runs the Vite dev server alongside the API and binds a port Render
> is not watching; a bare `node server/src/index.js` skips `prisma generate` and
> dies with `@prisma/client did not initialize yet`. `npm start` runs the API
> alone, and it serves the built client itself.
>
> Add no other variables. In particular not `RATE_LIMIT_DISABLED`.

**Shorter alternative:** **New** → **Blueprint** instead, and Render reads
[`render.yaml`](render.yaml) — every field above is already in it, and it asks
only for `DATABASE_URL`.

## B3 · Watch the build

Three to five minutes: install, `prisma generate`, build the client bundle, then
`db push` against Supabase — a no-op, since A2 already did it.

Wait for **`Your service is live`** and a green health check.

If the health check fails, open the URL it is checking. It says why:

```json
{ "status": "error", "database": "unreachable",
  "error": "Can't reach database server at ..." }
```

| What you see | What it means |
|---|---|
| `Can't reach database server` | `DATABASE_URL` is wrong, or the direct connection instead of the pooler |
| `@prisma/client did not initialize` | the build command is not the one above |
| Port scan timeout | the start command is not `npm start` |
| `JWT_SECRET is not set` | the variable is missing — the API refuses to start rather than sign forgeable tokens |

## B4 · Sign in and enrol your team

1. Open your Render URL.
2. Sign in as `superadmin@shiftly.com` with the one-time password from **A4**.
3. Choose your own password when asked. The temporary one stops working
   immediately.
4. **Employees** → pick a group card → **Add**. Management accounts need only a
   name, email and contact; outlet staff also get a department and stations.

Everyone you enrol gets their own one-time password, shown once, which they
replace on first sign-in. Who can do what is in [ACCESS.md](ACCESS.md).

## B5 · Checkpoint

Not just that it loaded — the parts that are easy to get wrong.

| Check | Expected |
|---|---|
| `https://<your-url>/api/health` | `"database": "connected"` |
| Open `/employees` directly in a new tab | The app loads, not a 404 |
| Sign in with a wrong password 25 times | Starts returning **429** |
| Enrol a Head Chef, sign in as them in a private window | They see only their own restaurant |

The last one is worth doing properly: it exercises enrolment, the one-time
password, the forced change and outlet scoping against the real deployment rather
than your laptop.

Two things to expect on the free tier while running these:

- **The first check may take ~50 seconds** if the instance has gone to sleep.
  Give it that before concluding anything is wrong.
- **The rate limiter counts in memory**, so a sleep-and-wake between attempts
  starts the count again. Do the 25 attempts in one go, or you may not see the
  429. A real attacker hammering the endpoint keeps it awake and does trip it.

---

## Costs, and what free actually costs

`render.yaml` sets `plan: free`, which is the right place to start: everything
works and you can test the whole thing for nothing.

| | |
|---|---|
| Render **Free** | $0 — sleeps after 15 min idle, no Shell tab, 750 instance-hours a month |
| Render **Starter** | $7/month — always on, Shell available |
| Supabase **Free** | 500 MB, and **pauses after 7 days of no activity** |

**A slow first load.** After 15 minutes idle the instance stops. The next request
takes around 50 seconds while it wakes — the page just sits there. Normal, not a
broken deploy. Everything after it is fast until it idles again.

**No Shell tab.** Phase A already works around this by running every setup command
from your own machine.

**Supabase pausing.** The one most likely to confuse you. Leave the project
untouched for 7 days and Supabase pauses it; the app then loads but `/api/health`
reports `"database": "unreachable"` and nothing works. It looks like the
deployment broke. It did not — go to the Supabase dashboard and **Restore**.

### When you move to paid

Change one line in [`render.yaml`](render.yaml):

```yaml
plan: starter     # was: free
```

Push, and Render redeploys on the paid instance. Or change **Instance Type** in
the dashboard, which takes effect without a deploy.

Nothing else moves. Same URL, same database, same accounts — no data is touched
and nobody signs in again. Do it before real staff use Shiftly on a shift: a
manager waiting fifty seconds mid-service is the whole reason not to stay on free.

---

## Afterwards

**Deploying a change** — push to `main`; Render rebuilds and restarts.

**Schema changes** — `npm run build:deploy` runs `prisma db push` on every deploy,
so a schema edit applies itself. `db push` writes no migration files; if you later
want a migration history, that is the point to adopt `prisma migrate`.

**Backups** — Supabase's free tier keeps daily backups for 7 days. If Shiftly
becomes the only record of your rosters, that is worth revisiting.

**Custom domain** — Render → Settings → Custom Domains. TLS is issued
automatically, and nothing in the app changes: the client calls `/api` relatively,
so it works on whatever host serves it.

**A locked-out user** — **Employees** → the key icon on their row issues a new
one-time password.

**Locked out yourself** — re-run `reset:superadmin` (A4). It deletes every
account, so on a live system treat it as a last resort: better to keep a second
Admin who can reset you.
