# smarTindahan

smarTindahan is a web app that helps sari-sari store owners run the shop: record sales at a point-of-sale screen, keep stock and prices up to date, track suppliers, customers and expenses, and see sales and profit at a glance. It works on phones, tablets and desktops.

## What it does today

| Area | What works |
| --- | --- |
| Accounts | Register with email verification (6-digit code), sign in, forgot/reset password, change password, sign out. Admin accounts have an `/admin` page (user list, stats, change a user's email or password, 15-minute impersonation). |
| Dashboard | Today's sales, today's estimated profit, inventory value, low-stock list, top sellers (all time), recent transactions, 7-day and month-to-date sales chart. Days are bucketed in Philippine time (UTC+8). |
| POS | Find a product by name, barcode or camera scan, build a cart, adjust quantities (never above stock), check out. Checkout is atomic and protected against double-submits. |
| Price list | Add, edit, archive products; bulk add; set minimum stock; set exact stock by recount. Sales history keeps the price and cost at the time of sale. |
| Business | Sales history, customers (name/contact/credit limit), suppliers, expenses, low-stock alerts, restock suggestions and slow-mover list (calculated from the store's own last 30 days of sales, no outside AI service), sales report (revenue, gross profit, margin, daily and payment-method breakdown), settings and theme. |
| Barcode | Camera scanning via ZXing, optional product-name lookup from Open Food Facts. |
| Legal and privacy | Public Terms of Service and Privacy Policy pages (versioned, **draft**), an unchecked agreement box at registration enforced by the API, consent records, re-acceptance when Terms change, data download, privacy requests and account deletion with a waiting period. See [docs/privacy-and-consent.md](docs/privacy-and-consent.md). |

See [Known limitations](#known-limitations) for what is **not** implemented (for example credit/utang ledgers and purchase orders).

## Technology

- **Frontend:** React 19, TypeScript, Vite 8, plain CSS. Tests: Vitest + Testing Library.
- **Backend:** Node.js 22, Express 5, TypeScript, Mongoose 9, JWT bearer tokens, bcrypt, Resend/SMTP email. Tests: `node:test` + an in-memory MongoDB replica set.
- **Database:** MongoDB (Atlas in production). Transactions are used, so a replica set is required (Atlas always is).
- **Hosting:** Vercel (static frontend + one serverless function that runs the Express app) and optionally GitHub Pages for the frontend only.

```
smarTindahan/
├─ api/index.js        Vercel function entry; re-exports the compiled Express app
├─ backend/            Express API (src/, tests/, dev/memoryServer.ts)
├─ frontend/           React + Vite app
├─ docs/               Deployment, database, testing, legal and audit documents
├─ vercel.json         Vercel build, output and routing
└─ .github/workflows/  CI and GitHub Pages deployment
```

## Prerequisites

- Node.js 22 (20.19+ also works) and npm 10+
- A MongoDB Atlas cluster (production) — local development needs nothing, see below
- Optional: a Resend API key (or SMTP credentials) to deliver verification codes

## Quick start (no database needed)

```bash
npm run install:all
```

```bash
npm run dev:memory --prefix backend
```

This starts the real API on port 5000 with an **in-memory** MongoDB and a clearly-labelled sample store. Sign in with `demo@smartindahan.test` / `DemoPass123`. All data disappears when you stop it. (The first run downloads a MongoDB binary, roughly 800 MB, into `backend/node_modules/.cache`.)

In a second terminal:

```bash
npm run dev --prefix frontend
```

Open http://localhost:5173. Vite proxies `/api` to the backend, so no CORS setup is needed.

## Running against your own MongoDB

1. Copy `backend/.env.example` to `backend/.env` and fill in `MONGODB_URI` and `JWT_SECRET` (generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`).
2. `EMAIL_MODE=development` only logs the recipient and subject — verification codes are **not** sent or printed. To register store-owner accounts against your own database, set `EMAIL_MODE=production` plus Resend or SMTP settings so you receive the code. To create an **admin** account (verified, signs in at `/admin`), set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (and optionally `ADMIN_FIRSTNAME`, `ADMIN_LASTNAME`, `ADMIN_MOBILE`, `ADMIN_STORE`, `ADMIN_ADDRESS`) in your shell, then run `npm run create-admin --prefix backend`. The password is read from the environment and never printed.
3. `npm run dev --prefix backend`

See [docs/database.md](docs/database.md) for Atlas setup and troubleshooting.

## Environment variables

Real values go in `backend/.env` (local) or in the Vercel project settings (production). **Never commit them.** Variable names:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | backend | MongoDB connection string. Include the database name in the path. |
| `JWT_SECRET` | backend | Signs session tokens. In production it must be at least 32 characters and not a placeholder, or the API refuses to start. |
| `JWT_EXPIRES_IN` | backend | Token lifetime, default `7d`. |
| `FRONTEND_URL` | backend | Allowed browser origin(s) for CORS, comma-separated, e.g. `https://app.vercel.app,https://you.github.io`. Production requires HTTPS origins. |
| `NODE_ENV` | backend | `production` enables strict validation, HSTS, proxy trust, and disables auto-indexing. |
| `PORT` | backend | Port for the long-running server (default 5000). Not used on Vercel. |
| `EMAIL_MODE` | backend | `development` (nothing is sent) or `production`. Production refuses `development`. |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | backend | Resend delivery. |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD` | backend | SMTP alternative (`EMAIL_PROVIDER=smtp`). |
| `ACCOUNT_DELETION_GRACE_DAYS` | backend | Waiting period before a closed account is permanently deleted (default 14). |
| `MONGODB_MAX_POOL_SIZE`, `MONGODB_MIN_POOL_SIZE` | backend | Optional pool tuning (defaults: 20/2, or 5/0 on Vercel). |
| `VITE_API_URL` | frontend (build time) | API base URL. Leave unset for local dev and Vercel (`/api`); set the full URL for GitHub Pages. **Public** — never put secrets in `VITE_*` variables. |
| `VITE_BASE_PATH` | frontend (build time) | Sub-path for GitHub Pages (set by the workflow). |

## Build, check and test

| Command | What it does |
| --- | --- |
| `npm run install:all` | `npm ci` in `backend/` and `frontend/` using the lockfiles |
| `npm run build` | Builds the backend (`backend/dist`) then the frontend (`frontend/dist`) — exactly what Vercel runs |
| `npm run typecheck` | Backend type check (the frontend is checked by its build) |
| `npm run lint` | Frontend ESLint |
| `npm test` | Backend tests, then frontend tests |

Details and what each suite covers: [docs/testing.md](docs/testing.md).

## Deployment

**Recommended: one Vercel project, one domain** (frontend and API share an origin, so no CORS needed).

1. Import the GitHub repo in Vercel. Leave **Root Directory** empty (the repo root) and **Framework Preset** as *Other*. `vercel.json` already sets the install command, build command (`npm run build`), output directory (`frontend/dist`) and routing:
   - `/api/*` → the serverless function in `api/index.js` (Express)
   - everything else → `index.html` (single-page app)
2. Add the environment variables from the table above in *Project → Settings → Environment Variables* (Production): `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_URL` (your Vercel domain, `https://…`), `NODE_ENV=production`, `EMAIL_MODE=production`, `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`.
3. In Atlas → *Network Access*, allow the connection (see [docs/database.md](docs/database.md): Vercel has no fixed outbound IPs).
4. Once, from your computer with `backend/.env` pointing at the production database: `npm run create-indexes --prefix backend`. Production never builds indexes automatically; the unique indexes (barcodes, supplier names, idempotency keys) must exist.
5. Deploy, then check `https://<your-domain>/api/health` → `{"status":"ok","database":"connected"}`.

**Optional: frontend on GitHub Pages.** Pages can only host the static build, so the API still lives on Vercel.

1. Repo *Settings → Pages → Source: **GitHub Actions*** (not "Deploy from a branch" — that publishes the repository root and shows this README instead of the app).
2. *Settings → Secrets and variables → Actions → Variables*: add `VITE_API_URL` = `https://<your-vercel-domain>/api`.
3. On the Vercel project add the Pages origin to `FRONTEND_URL`: `https://<your-domain>,https://<user>.github.io`.
4. Push to `main`; the *Deploy frontend to GitHub Pages* workflow builds with the right base path and publishes `frontend/dist`.

The app uses `Authorization: Bearer` tokens kept in `localStorage`, not cookies, so a separate frontend origin needs only CORS, not cookie/SameSite configuration.

### Why it was failing before

- `BUILD_UTILS_SPAWN_126` (permission denied): `node_modules/` was committed to Git from Windows. Those files carry mode `100644` (not executable) and Windows `.cmd` shims, so `tsc`/`vite` in `node_modules/.bin` could not run on Vercel's Linux builders. They are now untracked (`.gitignore` already lists them) and installed fresh by `npm ci`.
- `No entrypoint found in "/vercel/path0"`: Vercel looked for a server file at the repository root, but the Express app lives in `backend/src/server.ts`, exports `app` by name and only listens when run directly. `api/index.js` is now the explicit function entry point, and the experimental `services` block was removed from `vercel.json`.
- GitHub Pages showing the README: Pages was serving the repository root instead of the Vite build, and the build used a wrong base path (`/Heosphorus/Smartindahan/` instead of `/Smartindahan/`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/api/health` → `database: disconnected` | Check `MONGODB_URI`, Atlas Network Access and that the cluster is not paused. The function log shows a short, credential-free reason. |
| `querySrv ECONNREFUSED …` | Your network/DNS refuses SRV lookups. Use the **standard** (non-`+srv`) connection string from Atlas → Connect → Drivers → "I don't have a mongodb+srv…". |
| Frontend shows "The server sent an unexpected response" | `/api` is returning HTML: wrong `VITE_API_URL`, the rewrite is missing, or the frontend is hosted somewhere without the API. |
| Browser console: CORS error | The page's origin is not in `FRONTEND_URL` (exact origin, `https://`, no trailing path). |
| Registration succeeds but no email | `EMAIL_MODE` is `development`, or Resend's sender/domain is not verified (Resend's test sender only delivers to your own address). |
| API refuses to start / returns 503 | The function log states which production variable is missing or weak. |
| Login says "Too many attempts" | Per-IP limits (10 logins / 15 min). Accounts also lock for 15 minutes after 5 wrong passwords. |

## Known limitations

- **Credit (utang) is not implemented.** Customers can be stored with a credit limit, but no sale can be put on credit, there is no payment ledger, and "Outstanding utang" stays at ₱0. The checkout API rejects `Utang`.
- The POS always records payments as Cash (the API also accepts GCash and Maya, but the screen has no payment picker yet).
- No purchase-order/supplier-delivery records, discounts, change calculator, inventory history screen or date-range analytics filters.
- Rate limiting is in memory, per server instance; on Vercel each warm instance counts separately. Account lockout and OTP attempt limits are stored in the database and are not affected.
- Text inputs are limited to 64 characters (enforced in the UI and API).
- Sessions are bearer tokens in `localStorage` (valid up to 7 days, revoked on password change/reset). An XSS bug would expose them; the app renders no raw HTML.
- The app currently stores data in whatever database the connection string names. If `MONGODB_URI` has no database name in its path, MongoDB uses `test`. Existing data may live there; add a name only after migrating it.
- Visual testing was done at phone and desktop widths in one browser; dark mode and tablet widths were only spot-checked.

## Privacy and legal (draft, not launch-ready)

- The Terms of Service and Privacy Policy are **drafts with highlighted placeholders** (operator name, contacts, regions, retention periods). They have not been reviewed by the owner or by Philippine counsel, and the app makes no claim of legal compliance. Complete [the owner checklist](docs/privacy-and-consent.md#owner-decisions-and-legal-review-before-launch) first.
- After deploying, run `npm run create-indexes --prefix backend` (new collections) and **schedule `npm run purge-deleted-accounts --prefix backend` daily**; until then, accounts whose deletion period ended are not deleted.
- Signing out revokes the token on the server. Tokens issued before this change are rejected, so everyone signs in once more.
- Existing accounts have no consent record; they are asked to accept the Terms on next sign-in (nothing is back-filled).
- Not built: marketing consent (the app sends no marketing), admin screens for policies/requests/audit logs, self-service email change, retention jobs for audit/consent records.

## Security notes

- `backend/.env` is ignored by Git. **An earlier commit (`0553dbd`) contained a real `backend/.env`** (Atlas credentials and a Resend API key). Rotate the Atlas database user's password and the Resend key, because Git history is permanent for anyone who can read the repository.
- Authorization is enforced on the server: every store route derives the store from the verified token, never from request input, and queries are always scoped by `storeId`.
- Inputs are type- and range-validated; Mongoose casting plus strict ObjectId parsing block NoSQL operator injection.

## Further reading

- [docs/database.md](docs/database.md) — Atlas setup, access list, indexes, transactions
- [docs/testing.md](docs/testing.md) — test suites and how to run them
- [docs/privacy-and-consent.md](docs/privacy-and-consent.md) — policies, consent records, versions, data export/deletion, owner decisions
- [docs/api/barcode-inventory.md](docs/api/barcode-inventory.md) — barcode/inventory API contract
- [docs/legal/](docs/legal) — privacy, terms, security and retention policies
- [docs/audits/](docs/audits) — earlier audit notes
