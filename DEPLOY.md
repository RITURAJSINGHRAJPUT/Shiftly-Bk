# Putting Bookends Shiftly live

One Render **Web Service** serving both the app and the API, with Supabase for
Postgres. Roughly 30 minutes end to end.

Everything runs from **one URL**. The client is built into `client/dist` and
served by the same Express process that answers `/api`, so there is no second
service, no CORS to configure, and no second thing to keep in step.

---

## Before you start

Two things from the build of this app that must be dealt with first.

**Rotate the Supabase `service_role` key.** It was visible in a screenshot during
development. It grants full read and write to your database on its own, bypassing
every rule in this app. Bookends Shiftly never uses it — Prisma connects with the Postgres
connection string — so rotating costs you nothing.

> Supabase → Project Settings → API → `service_role` → **Reset**

**Do not set `RATE_LIMIT_DISABLED` on Render.** It exists so local test runs can
sign in dozens of times without tripping the limiter. On a live instance the
login limiter is what stands between your data and someone guessing passwords.

---

## 1 · The database

1. Supabase → your project → **Connect**.
2. Copy the **Session pooler** connection string. It looks like:

   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
   ```

3. Replace `[YOUR-PASSWORD]` with your database password.

> **Session pooler, not the direct connection.** Render's instances get new IP
> addresses, and the direct connection is IPv6-only on the free Supabase tier —
> which fails from Render with a confusing `P1001 Can't reach database server`.
> The pooler is IPv4 and is the connection Supabase recommends for this.

Keep that string somewhere for step 3. It is a password in a URL — treat it as one.

---

## 2 · Push to GitHub

Render deploys from a repository, so it needs one.

```bash
git add -A
git commit -m "Deployment configuration"
git push origin main
```

Nothing secret goes with it: `.env` and `dist/` are both gitignored, and
`render.yaml` names `DATABASE_URL` without containing it.

---

## 3 · The Render Web Service

Bookends Shiftly deploys as a **Web Service** — Render's type for a long-running process
that listens on a port. The other types cannot host it: a **Static Site** serves
files with no Node process behind them, so `/api` would have nowhere to go; a
**Private Service** has no public URL; a **Background Worker** has no HTTP
listener at all.

There are two ways to create it. Both produce the same Web Service.

### 3a · From the blueprint — fewer things to get wrong

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**.
2. Pick this repository. Render reads [`render.yaml`](render.yaml), sees
   `type: web`, and proposes a Web Service called **shiftly** with the build
   command, start command, health check, region and plan already filled in.
3. It asks for the one value the file deliberately does not contain:

   | | |
   |---|---|
   | `DATABASE_URL` | the pooler string from step 1 |

4. **Apply**.

### 3b · By hand — if you would rather see every field

**New** → **Web Service** → connect this repository, then:

| Field | Value |
|---|---|
| Language / Runtime | **Node** |
| Branch | `main` |
| Region | Singapore (closest of Render's to Surat) |
| Root Directory | *leave empty* — the build runs from the repository root |
| Build Command | `npm install && npm run build:deploy` |
| Start Command | `npm start` |
| Instance Type | **Free** — switch to Starter when you go live |
| Health Check Path | `/api/health` — under *Advanced* |

Then add two environment variables:

| Key | Value |
|---|---|
| `DATABASE_URL` | the pooler string from step 1 |
| `JWT_SECRET` | click **Generate** |

> **The build and start commands are where the last attempt failed.** A start
> command of `npm run dev` or a bare `node server/src/index.js` will not work:
> the first runs the Vite dev server alongside the API and binds a port Render
> is not watching, and the second skips `prisma generate`, so the process dies
> with `@prisma/client did not initialize yet`. `npm start` runs the API alone,
> and it serves the built client itself.
>
> Leave `RATE_LIMIT_DISABLED` unset. It is a local testing flag; on a live
> instance the login limiter is what stops someone guessing passwords.

---

Either way, the first build takes 3–5 minutes: it installs, generates the Prisma
client, builds the client bundle and pushes the schema to Supabase.

Watch for `Your service is live` and a health check that goes green. If the
health check fails, read it — it now says *why*:

```json
{ "status": "error", "database": "unreachable",
  "error": "Can't reach database server at ..." }
```

That is almost always a wrong `DATABASE_URL`, or the direct connection string
used instead of the pooler.

---

## 4 · Move your restaurants across

`prisma db push` creates tables, not rows, so Supabase has the schema and nothing
in it. Copy the organisation, brands and outlets — including each brand's station
list — from the database you built them in:

```bash
# see what it would copy, without writing
TARGET_DATABASE_URL='<the pooler string from step 1>' \
  npm --prefix server run migrate:structure -- --dry-run

# then for real
TARGET_DATABASE_URL='<the pooler string from step 1>' \
  npm --prefix server run migrate:structure
```

It preserves ids, so running it twice updates the same rows rather than making a
second copy of everything.

**People are deliberately not copied.** Employee rows carry password hashes and,
in a database you have been developing against, test accounts. You create the
real ones in the next step.

> Starting from nothing instead? Skip this. Since the super admin can now create
> an organisation from the **Organizations** page, you can build the whole
> hierarchy in the app — organisation, then brands, then outlets.

---

## 5 · Create your account

The database has your restaurants but nobody to sign in as. Run this **from your
own machine**, pointed at the Supabase database:

```bash
DATABASE_URL='<the pooler string from step 1>' \
  npm --prefix server run reset:superadmin
```

It talks to Postgres directly and does not need the server, so it works the same
whether the Render instance is awake, asleep or still building.

It prints a one-time password **once**. Open your Render URL, sign in as
`superadmin@shiftly.com`, and choose your own password when asked.

> On a **paid** instance you could equally run it from Render → your service →
> **Shell**, without the `DATABASE_URL` prefix. Free instances have no Shell tab,
> which is why the local form is the one given here.

From there: **Employees** → pick a group card → enrol your managers and staff.
Each gets a one-time password shown once, which they replace on first sign-in.
Who can do what is in [ACCESS.md](ACCESS.md).

---

## 6 · Check it actually works

Not just that it loaded — that the parts which are easy to get wrong are right.

| Check | Expected |
|---|---|
| `https://<your-url>/api/health` | `"database": "connected"` |
| Open `/employees` directly in a new tab | The app loads, not a 404 |
| Sign in with a wrong password 25 times | Starts returning **429** |
| Enrol a Head Chef, sign in as them in a private window | They see only their own restaurant |

That last one is the one worth doing properly. It exercises enrolment, the
one-time password, the forced change and outlet scoping against the real
deployment rather than your laptop.

Two things to expect on the free tier while running these:

- **The first check may take ~50 seconds** if the instance has gone to sleep.
  Give it that before concluding anything is wrong.
- **The rate limiter counts in memory**, so a sleep-and-wake between attempts
  starts the count again. That is fine — a real attacker hammering the endpoint
  keeps it awake and does trip it — but do the 25 attempts in one go, or you may
  not see the 429.

---

## Costs, and what free actually costs

`render.yaml` sets `plan: free`, which is the right place to start: everything
works, and you can test the whole thing for nothing.

| | |
|---|---|
| Render **Free** | $0 — sleeps after 15 min idle, no Shell tab, 750 instance-hours a month |
| Render **Starter** | $7/month — always on, Shell available |
| Supabase **Free** | 500 MB, and **pauses after 7 days of no activity** |

Three things to expect while testing on free:

**A slow first load.** After 15 minutes idle the instance stops. The next request
takes around 50 seconds while it wakes — the page just sits there. That is normal
and not a broken deploy. Every request after it is fast until it idles again.

**No Shell tab.** Step 4 already works around this by running the setup from your
own machine.

**Supabase pausing.** This is the one likely to confuse you. Leave the project
untouched for 7 days and Supabase pauses it; the app then loads but
`/api/health` reports `"database": "unreachable"` and nothing works. It looks
like the deployment broke. It did not — go to the Supabase dashboard and
**Restore** the project.

### When you move to paid

Change one line in [`render.yaml`](render.yaml):

```yaml
plan: starter     # was: free
```

Push, and Render redeploys on the paid instance. Or change **Instance Type** in
the dashboard directly, which takes effect without a deploy.

Nothing else moves. Same URL, same database, same accounts — no data is touched
and nobody has to sign in again. Do it before real staff start using Shiftly on a
shift, because a manager waiting fifty seconds mid-service is the whole reason
not to stay on free.

---

## Afterwards

**Deploying a change** — push to `main`; Render rebuilds and restarts.

**Schema changes** — `npm run build:deploy` runs `prisma db push` on every
deploy, so a schema edit applies itself. `db push` does not generate migration
files; if you later need a migration history, that is the point to adopt
`prisma migrate`.

**Backups** — Supabase's free tier keeps daily backups for 7 days. If Shiftly
becomes the only record of your rosters, that is worth revisiting.

**Custom domain** — Render → Settings → Custom Domains. TLS is issued
automatically. Nothing in the app needs changing: the client calls `/api`
relatively, so it works on whatever host serves it.

**A locked-out user** — Employees → the key icon on their row issues a new
one-time password. If *you* are locked out, `reset:superadmin` from the Render
shell will get you back in, but it deletes every account, so treat it as a last
resort rather than a password reset.
