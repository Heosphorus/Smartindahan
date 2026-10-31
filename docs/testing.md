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
- `restock.test.ts` – restock suggestions: days of stock left, suggested quantity and cost, ordering by urgency, minimum-stock rule, slow movers, low confidence for new products, and the API using only the signed-in store's own sales and stock.
- `bulk.test.ts` – bulk add products: a price per product with a shared default for the rest, shared stock and brand, cost optional (stored as 0), one bad price rejects the batch, starting stock recorded in stock history and audit log, old names-only requests still work, bad numbers and over-long names rejected with nothing created, only the signed-in store is written.
- `categories.test.ts` – renaming and deleting categories: only the signed-in store's products change, archived products stay in step, a lookalike name merges into the existing category, delete moves products (never removes them) to Uncategorized or a chosen category, bad or unknown names are rejected, changes are audited.
- `rateLimit.test.ts` – JSON 429 over the limit, standard rate-limit headers, the general limiter, and IPv6 clients grouped by network prefix.
- `mongoUri.test.ts` – placeholder connection-string detection compares the real host, so look-alike hosts and passwords containing "example.com" are not mistaken for it.
- `config.test.ts` – production environment validation (weak or missing secrets, non-HTTPS origins, email mode).
- `authMiddleware.test.ts`, `storeTime.test.ts`, `validation.test.ts` – unit tests (`validation.test.ts` includes the email check and a hostile-input timing test).
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
- `features/business/BusinessPages.test.tsx` – create/edit dialogs: failed save shown inside the dialog with the typed text kept, a single submission while saving, success message; Reports empty states and tables.
- `features/business/RestockSuggestions.test.tsx` – restock table order and wording, cover-days selector, empty state, error with retry.
- `features/store/BulkProducts.test.tsx` – bulk add dialog: 256-character names box with counter, same fields as Add product, pricing placeholder, `Name, price` lines with a shared default price for lines without one, cost optional with an explanatory note, bad prices/cost and over-long names rejected, duplicates skipped, numeric payload sent from the Price List.
- `features/store/ProductCategory.test.tsx` – Add/Edit product category dropdown: lists the store's categories once each, saves a chosen category, accepts a new typed category, reuses the existing spelling for case/spacing differences, asks for a category when none is given.
- `features/store/CategoryManager.test.tsx` – Manage categories dialog: product counts, rename (reloads the list and moves the category filter), blank/unchanged names never reach the server, delete asks where products go and offers Uncategorized, cancel changes nothing, server errors shown in the dialog.
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
