# Public API

A read-only integration surface for systems outside Shiftly — a partner
dashboard, a BI job, a careers page. One endpoint today: the staff roster,
grouped by outlet.

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

Give each consumer its own key. Revoking one is then a matter of removing it
from the list and restarting, without disturbing anyone else. Server logs
record a six-character fingerprint of the key used, never the key itself, so
requests can be attributed after the fact.

---

## `GET /api/public/staff`

```bash
curl -s -H 'X-API-Key: YOUR_KEY' https://your-host/api/public/staff
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

- This endpoint has no entry in [ACCESS.md](ACCESS.md). That file is generated
  from `server/src/lib/capabilities.js`, whose guards are role-based and need a
  logged-in user; a key has no role. The gate here is `requireApiKey` in
  `server/src/middleware/apiKey.js`.
- Browsers on another origin are blocked by CORS unless that origin is listed
  in `CORS_ORIGIN`. The intended use is server to server.
- Every other endpoint in the system is documented in **[API.md](API.md)**.
