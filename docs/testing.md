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
- `batch.test.ts` – batch price edit and batch archive: set / ± percent / ± amount maths with centavo rounding, selling and/or cost changed together, one invalid result rejects the whole batch with nothing changed, malformed or unauthenticated requests refused, other stores' and archived products ignored, per-product audit entries.
- `inventory.test.ts` – inventory workflow: server-side product search (name, SKU, barcode, brand; regex characters taken literally), category / low / out filters, pagination and whole-store summary counts; barcode lookup within the store only (UPC-A / EAN-13 variants, archived products reported and restorable, duplicates refused); pack sizes (validation, audit of changes); restock with pack-to-piece conversion, frozen cost history, purchase records and traceable movements, keep-cost option, rejection and full rollback, idempotent retries (sequential, parallel, and a reused key with different items refused); concurrent sales + restocks + removals ending at the exact expected stock; no overselling or negative stock; stock-in / stock-out validation and idempotency; two-phase stock counts (save never changes stock, apply once even when sent in parallel, later sales kept, unsafe apply refused with nothing changed, discard, legacy single-count requests); tenant isolation for products, purchases, counts and history.
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
- `features/store/priceListExport.test.ts` – Print / download file builders: table order and optional columns (cost never included unless chosen), the zip writer read back with an independent CRC check, .xlsx and .docx parts well-formed with real numbers and formula-looking text kept as text, XML-illegal characters dropped, escaped print page, file names.
- `features/store/priceAdjust.test.ts` – batch price input parsing and the preview maths, matching the server.
- `features/store/PriceListBatch.test.tsx` – row selection (page / all matching, cleared when filters change), batch edit preview, payload and errors, batch delete confirmation, Print / download dialog scopes (all, category, picked products), downloads and the print frame.
- `features/inventory/inventoryMath.test.ts` – stock status rules, pack-to-piece conversion (whole pieces only, same as the server), number parsing, barcode-versus-word detection, restock line checks and totals.
- `features/inventory/StockTab.test.tsx` – Stock tab: loading / empty / error with retry, status chips with counts, debounced server search (one request per pause), category / sort / pagination parameters, USB-scanner Enter and camera scans (found, unknown, archived + restore, lookup failure keeps manual entry), quick add (pack conversion, same key on retry, single submission), quick remove (two-step confirm, over-stock refused), price and alert edits (only changed fields sent, below-cost warning), stock history, hand-off to Restock.
- `features/inventory/RestockTab.test.tsx` – Restock tab: search / scan / suggestions to build a delivery, pack versus piece units, per-line problems block review, review screen, exact payload and one idempotency key, single submission on double click, failure keeps the delivery and retries with the same key, repeated-delivery notice, fresh key for the next delivery.
- `features/inventory/CountTab.test.tsx` – Count tab: counts list states, scanning counts +1 (USB and continuous camera), difference as you type, reasons only for differences, save without changing stock, review with moved-since-count and below-zero warnings, confirm then apply once, refused apply leaves the count open, leave / discard confirmations.
- `features/inventory/InventoryPage.test.tsx` – tab roles and arrow / Home / End keys, drafts kept when switching tabs, Stock → Restock hand-off, stock list reloads after a delivery.
- `features/pos/POSFlow.test.tsx` – price display, single submission with one idempotency key, name search, stock-capped quantities, checkout failure keeps the cart.

## Manual end-to-end journey

Fastest way to click through the whole product without any account or database:

```bash
npm run dev:memory --prefix backend
npm run dev --prefix frontend
```

Sign in as `demo@smartindahan.test` / `DemoPass123`. The demo owner has no agreement record on purpose, so the first sign-in shows the Terms review screen (accept to continue; the Privacy Policy notice then appears as a banner). Then: dashboard → Price List (add a product) → POS (search, add, change quantity, checkout) → dashboard (totals, low stock, transactions updated) → Sales History → Reports → Settings (change password) → sign out.

## What is not automated

- No browser-driven (Playwright/Cypress) suite is committed; the journey above was exercised manually in a browser, including 375 px phone width. The Inventory page (added later) has component tests only: its responsive layout, dark mode, camera scanning on a real device and USB scanner timing have **not** been checked in a browser.
- jsdom has no layout engine, so "responsive layout" is covered only by the CSS rules themselves (`features/inventory/Inventory.css`), not by a test.
- Email delivery through Resend/SMTP is not tested; `EMAIL_MODE=development` skips sending.
- A deployed Vercel/GitHub Pages environment is not tested by CI. After each deploy check `/api/health`, sign in, and make one sale.
