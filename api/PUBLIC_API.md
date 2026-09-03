# Public API

A read-only integration surface for systems outside Shiftly — a partner
dashboard, a BI job, a careers page. One endpoint today: the staff roster,
grouped by outlet.

**Base URL:** `https://shiftly-bk.onrender.com`

Two browsable pages are published for whoever is integrating on the other end:

- **[Step-by-step guide](https://claude.ai/code/artifact/720061da-49f4-4e3d-b315-2bb21ea81cb7)**
  — a walkthrough from one `curl` call to a working staff list on their page. Send
  this one first.
- **[API reference](https://claude.ai/code/artifact/1692506a-a2ac-4450-9a9a-61461a0b9516)**
  — every parameter, field and status code, to come back to.

Neither page contains a key.

It is the only part of the API that is not behind a login. A shared API key
stands in for the user.

---

## Enabling it

Set `PUBLIC_API_KEYS` in `server/.env` — one key, or several separated by
commas:

```
PUBLIC_API_KEYS=Yk3n...,7Qp2...
```

Mint one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**With the variable unset the endpoint answers `503`.** It is never open
without a key: an unconfigured deployment fails closed rather than publishing
the roster to the internet.

### Allowing a browser to call it

Browser JavaScript on another site is blocked by CORS until its origin is listed
in `PUBLIC_API_ORIGINS`:

```
PUBLIC_API_ORIGINS=https://example.com,https://www.example.com
```

Unset means no other site's JavaScript can read the API. Server-to-server callers
are unaffected either way, since CORS is enforced by browsers, not by us.

Both variables are set in the Render dashboard on the **`shiftly-bk`** service,
not in `render.yaml` — the blueprint lists them as `sync: false` so it records
that they exist without carrying their values.

#### What format to send the origin in

An origin is **scheme + host + optional port, and nothing else**. Send it exactly
in that form:

| | Value | |
|---|---|---|
| ✅ | `https://example.com` | Correct |
| ✅ | `https://www.example.com` | A *different* origin from the apex — send both if the site answers on both |
| ✅ | `https://shop.example.com` | Each subdomain is its own origin |
| ✅ | `http://localhost:3000` | Fine while developing; take it out afterwards |
| ❌ | `example.com` | The scheme is part of the origin and is required |
| ❌ | `https://example.com/` | A trailing slash is not part of an origin |
| ❌ | `https://example.com/staff` | Never include a path |
| ❌ | `*.example.com` | No wildcards — list subdomains individually |

Several go in one variable, comma-separated:

```
PUBLIC_API_ORIGINS=https://example.com,https://www.example.com
```

The comparison is exact, with surrounding whitespace and a trailing slash
forgiven. Everything else must match character for character — `http` and
`https` are different origins, and so are the apex and `www` forms. This is
worth getting right first time: when it is wrong the browser reports a generic
CORS failure that says nothing about *which* part did not match.

If you are unsure what the origin is, open the site that will make the call and
run `location.origin` in the browser console. Whatever it prints is the exact
string to send.

### Keys

Give each consumer its own key. Revoking one is then a matter of removing it
from the list and restarting, without disturbing anyone else. Server logs
record a six-character fingerprint of the key used, never the key itself, so
requests can be attributed after the fact.

---

## `GET /api/public/staff`

```bash
curl -s -H 'X-API-Key: YOUR_KEY' https://shiftly-bk.onrender.com/api/public/staff
```

The key goes in `X-API-Key`. `Authorization: Bearer YOUR_KEY` is accepted too,
for clients that only speak bearer tokens.

### Query parameters

| Param | Effect |
|---|---|
| `outlet` | One outlet, by id |
| `brand` | Outlets belonging to one brand |
| `org` | Outlets belonging to one organization |
| `department` | `KITCHEN` · `SERVICE` · `HOUSEKEEPING` |
| `role` | `OUTLET_MANAGER` · `MASTER_OF_HOUSE` · `HEAD_CHEF` · `STAFF` |
| `includeInactive` | `true` adds deactivated outlets and staff |

`department` and `role` filter the staff inside each outlet; `outlet`, `brand`
and `org` filter which outlets appear at all. An unknown value for `department`
or `role` returns `400` naming the accepted set.

Passing an administration role — `SUPER_ADMIN`, `ADMIN`, `HR` — also returns
`400`. Those accounts are never in the response, so an empty result would read
as "this business has no admins" rather than "you cannot ask that here".

### Response

Outlets sorted by name, staff sorted by name. Outlets with no matching staff
are still listed, with an empty array — a consumer mirroring the outlet list
needs to see the quiet ones.

```json
{
  "generatedAt": "2026-09-03T09:00:00.000Z",
  "outletCount": 2,
  "staffCount": 37,
  "outlets": [
    {
      "id": "8c1f…",
      "name": "Bookends Piplod",
      "address": "…",
      "isActive": true,
      "brand": { "id": "3a7e…", "name": "Bookends" },
      "organization": { "id": "11b0…", "name": "KG Group" },
      "staffCount": 19,
      "staff": [
        {
          "id": "d4a2…",
          "employeeCode": "BK-014",
          "name": "Asha Menon",
          "role": "HEAD_CHEF",
          "department": "KITCHEN",
          "skills": ["grill", "pass"],
          "isActive": true,
          "joinDate": "2025-04-01T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

Not paginated. The grouping is the point, and the data is bounded by how many
outlets the business actually runs.

### Status codes

| Code | Meaning |
|---|---|
| `200` | Roster returned |
| `400` | Unknown `department` or `role` |
| `401` | Key missing or wrong |
| `429` | Over 60 requests a minute for this key |
| `503` | `PUBLIC_API_KEYS` is not set |

Rate limiting is keyed on the API key rather than the address, so one busy
integrator cannot exhaust another's budget.

---

## What it does not expose

### Administration accounts

`SUPER_ADMIN`, `ADMIN` and `HR` are excluded from every response. They are staff
of the business rather than of an outlet, and a roster integration has no use
for them.

The exclusion is by role, not by whether the account happens to be attached to
an outlet. Today all of them have `outletId: null` and would fall out of an
outlet-grouped response on their own, but assigning an HR to an outlet is a
supported thing to do and must not quietly publish them.

### Fields

The staff fields above are an allowlist in
`server/src/routes/public.routes.js`, not a list of exclusions — a column added
to `Employee` later stays private until someone names it there.

Deliberately absent:

- **`email`, `phone`, `avatar`** — contact PII, and the login identifier.
- **`password`** — the bcrypt hash, never returned anywhere.
- **`mustChangePassword`** — account state, of no use to an integrator.
- **Outlet `latitude`, `longitude`, `radius`** — the attendance geofence.
  Publishing it tells anyone precisely where to stand, or what to spoof, to
  clock in.
- **Shifts, attendance, leave** — no schedule or absence data of any kind.

---

## Notes

- This endpoint has no entry in [ACCESS.md](../ACCESS.md). That file is generated
  from `server/src/lib/capabilities.js`, whose guards are role-based and need a
  logged-in user; a key has no role. The gate here is `requireApiKey` in
  `server/src/middleware/apiKey.js`.
- CORS for this API is scoped to its own router (`server/src/middleware/publicCors.js`)
  and driven by `PUBLIC_API_ORIGINS`. The app-wide `CORS_ORIGIN` stays unset:
  opening that to serve one endpoint would expose every JWT-guarded route to
  cross-origin reads as well.
- A key embedded in browser JavaScript is readable by anyone who views source. It
  is not a secret there — it is revocable, it identifies the consumer in logs, and
  it keeps casual traffic off the endpoint. The data being non-PII is what makes
  that acceptable.
- The rate limit is 60/min per **visitor**, not per key: one key is shared by every
  visitor to the consumer's site, so a key-only budget would rate-limit its own
  readers. Responses carry `Cache-Control: public, max-age=300`.
- Render's free instance sleeps after ~15 minutes idle; the first call after that
  takes ~50s. Consumers need a generous timeout.
- Every other endpoint in the system is documented in **[API.md](API.md)**.
