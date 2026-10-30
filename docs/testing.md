# Testing guide

## Run everything

```bash
npm run install:all
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs the backend suite and then the frontend suite. No real database or network is needed.

## Backend (`backend/tests`)

Runner: Node's built-in `node:test` through `tsx`.

```bash
npm test --prefix backend
```

- `integration.test.ts` boots the real Express app against a throw-away in-memory MongoDB **replica set** (so transactions behave as in production) and calls it over HTTP. It covers: health and JSON 404s, CORS allow/deny, authentication and admin role checks, product validation and CRUD, tenant isolation, inventory changes, barcode lookup, checkout totals/profit/frozen prices, rollback of partially failing checkouts, the same product twice in one cart, idempotent retries (including a concurrent burst), concurrent oversell protection, Manila-time dashboard buckets, suppliers, expenses, pagination validation, change/reset password, registration → verification → login, forgot-password enumeration resistance, NoSQL operator payloads and overlong input.
- `privacy.test.ts` – policies and consent: public versioned policies, registration refused without server-side agreement or with stale versions, exact versions recorded, failed registration leaves no account or acceptance record, publishing keeps old versions, changed Terms block store routes until accepted (privacy notices do not), append-only history, token-level logout revocation, own-data-only export, privacy requests, account deletion (confirmation, grace period, cancel, purge touches only that account), no secrets in audit/consent records, registration rate limit.
- `config.test.ts` – production environment validation (weak or missing secrets, non-HTTPS origins, email mode).
- `authMiddleware.test.ts`, `storeTime.test.ts`, `validation.test.ts` – unit tests.
- `tenantIsolation.test.ts` – legacy test that needs a real database; skipped unless `MONGODB_TEST_URI` is set (use a disposable database).

The first run downloads a MongoDB binary (about 800 MB) into `backend/node_modules/.cache/mongodb-memory-server`; later runs reuse it. In CI the download happens on every run unless the cache is kept.

## Frontend (`frontend/src`)

Runner: Vitest + jsdom + Testing Library.

```bash
npm test --prefix frontend
```

- `services/apiClient.test.ts` – network failures, HTML-instead-of-JSON responses, error messages, token header.
- `features/auth/AuthPage.test.tsx` – login/register behaviour, unverified-account flow.
- `features/auth/AuthRegistration.test.tsx` – agreement box unchecked by default, links to both policies open in a new tab and are focusable, validation message and focus when unticked, exact versions sent, re-ask after a version mismatch, no registration when policies fail to load.
- `features/legal/Legal.test.tsx` – policy page (draft notice, highlighted placeholders, section navigation, retry), review gate for changed Terms, non-blocking privacy notice, data download, deletion confirmation.
- `features/pos/POSFlow.test.tsx` – price display, single submission with one idempotency key, name search, stock-capped quantities, checkout failure keeps the cart.

## Manual end-to-end journey

Fastest way to click through the whole product without any account or database:

```bash
npm run dev:memory --prefix backend
npm run dev --prefix frontend
```

Sign in as `demo@smartindahan.test` / `DemoPass123`. The demo owner has no agreement record on purpose, so the first sign-in shows the Terms review screen (accept to continue; the Privacy Policy notice then appears as a banner). Then: dashboard → Price List (add a product) → POS (search, add, change quantity, checkout) → dashboard (totals, low stock, transactions updated) → Sales History → Reports → Settings (change password) → sign out.

## What is not automated

- No browser-driven (Playwright/Cypress) suite is committed; the journey above was exercised manually in a browser, including 375 px phone width.
- Email delivery through Resend/SMTP is not tested; `EMAIL_MODE=development` skips sending.
- A deployed Vercel/GitHub Pages environment is not tested by CI. After each deploy check `/api/health`, sign in, and make one sale.
