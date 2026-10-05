# SariSmart Repository Audit

**Assessment date:** 2026-10-06  
**Scope:** Source/configuration review of the current worktree. The active `backend/.env` was deliberately not opened or reproduced. Atlas console configuration cannot be inspected from this repository. This is an engineering assessment, not a legal compliance certification.

## Executive Summary

SariSmart is a React/TypeScript/Vite frontend with an Express/TypeScript backend using Mongoose and MongoDB Atlas configuration. The existing stack is appropriate and was retained. Targeted fixes have since been made for database-authoritative JWT identity, owner-only API access, write allow-lists, inventory transactions, startup safety, safe errors, archival, pagination, audit events, and frontend expired-session handling. Current validation is recorded in the remediation snapshot below.

The most consequential findings are:

- **Critical: cross-store write tampering.** Several store-scoped create handlers put a server-derived `storeId` before spreading `req.body`; the body can overwrite it. Update handlers pass the complete body to `$set`, allowing callers to move a record between stores and mutate protected fields. Read filters alone do not prevent this.
- **High: JWT authorization state is stale/client-claim based.** Middleware verifies a JWT signature but trusts its embedded `role`, `email`, and `id` without reloading account status, current role, or membership. Role changes and account deactivation do not revoke already issued tokens before expiry.
- **High: unsafe index synchronization at startup.** `connectDatabase()` calls `ProductModel.syncIndexes()`. Mongoose synchronization can drop indexes missing from the current schema; it is an automatic startup action against the configured database.
- **High: inventory write integrity is incomplete.** Checkout uses a session, but stock-in, stock-out, and inventory-count update product stock separately from their transaction history. Concurrent requests can oversell stock. Actor IDs are populated with the store ID rather than the authenticated operator ID.
- **High: secrets exposed and tracked history requires cleanup.** The active credentials were included in conversation attachments. Git status shows `backend/.env` staged for deletion from the index, but that change is not committed; the current committed revision therefore still contains it. Rotate every exposed secret and complete the removal commit after review.
- **High: financial credit/utang is mutable without a payment ledger.** Customer create/update accepts client-supplied `outstandingBalance` and utang dates. Sales marked `Utang` do not update a customer ledger; payments, reversals, and immutable credit history are not implemented.

## Current Remediation Snapshot

The compliance matrix and scorecard that follow preserve the initial pre-remediation audit baseline. For the current worktree, use this delta as the authoritative status:

| Area | Current status after fixes |
| --- | --- |
| Authentication identity | Middleware verifies the JWT, reloads active/verified user state and DB role, and enforces `tokenVersion`. Password/email changes increment the version. |
| Store access | Store/business routes require `STORE_OWNER`; store context is derived from the authenticated owner. Manager/cashier access remains deliberately disabled because no membership management exists. |
| Write isolation | Product/customer/supplier/expense/settings updates use field allow-lists; client writes cannot set store ownership, stock through metadata edits, or customer outstanding balance/utang dates. Resource updates remain scoped by store. |
| Inventory and sales | Checkout and stock-in/out/count use Mongoose transactions with movement records and authenticated actor IDs. The API behavior has not been run against an isolated replica-set test database. |
| Database startup | Removed `syncIndexes()`; production auto-indexing is disabled. `npm run create-indexes` is an explicit additive index command and is not called during startup. |
| API behavior | Generic Express error mapping, a 1 MB JSON limit, auth/OTP route limits, paginated tenant lists (max 100), and frontend token clearing on authenticated 401 responses are implemented. Rate limiting remains process-local. |
| Historical records and audit | Product/customer/supplier/expense deletion is archival; outstanding-balance customers cannot be archived. Core business changes have structured audit events, with some non-transactional CRUD audit writes still separate from the underlying write. |
| Bootstrap secrets | Admin bootstrap requires an environment-provided strong password and no longer prints it; it uses the centralized connection. `.gitignore` covers `.env.*` while allowing `.env.example`. |
| Remaining high-risk work | Rotate secrets exposed in conversation, commit the staged env-file removal, verify Git history, implement customer credit/payment ledger, staff membership, shared rate limiting, and run API/concurrency tests against a dedicated test database. Atlas backup/security settings remain unverified. |

The original matrix below is retained as the auditable pre-change baseline; do not interpret its former FAIL/PARTIAL values as a description of the current fixed source without applying this delta.

## Architecture

| Area | Verified current implementation |
| --- | --- |
| Frontend | React 19, TypeScript, Vite; frontend build through `tsc -b && vite build`; ESLint available. |
| Backend | Node.js, Express 5, TypeScript; `tsx watch` for development and `tsc` for build. |
| Database / ODM | MongoDB Atlas is intended through Mongoose. `backend/src/config/database.ts` is the application connection module and reads configuration through `backend/src/config/env.ts`. |
| API architecture | Browser calls `/api/...`; Vite proxies `/api` to `http://localhost:5000`; Express mounts auth, store, business, and admin routers. No frontend direct database access is established by the app source. |
| Authentication | Bearer JWT, bcrypt password hashes, email verification and password-reset OTP records. |
| Authorization | JWT middleware; admin router uses `requireRole('ADMIN')`; store/business routes authenticate, but most do not enforce endpoint-specific store roles. |
| Tenant model | Store-owned documents reference `User` as `storeId`; controllers currently treat the authenticated user ID as the store ID. There is no Store collection or staff membership model. |
| Environment | `dotenv` loads backend environment variables. `.env.example` contains blank secret placeholders. The active `.env` is ignored by the present `.gitignore`, but its index removal is staged and not yet committed. |
| Tests | Node built-in test runner with `tsx`; only `backend/tests/authService.test.ts` exists. No API integration, tenant isolation, frontend, or database integrity tests are present. |
| Lint/build | Backend TypeScript build passes. Frontend build passes. Frontend ESLint currently reports five errors. Backend has no lint script. Root `package.json` has dependency metadata but no useful project scripts. |
| Deployment | No Docker, Compose, or deployment manifests were found by the repository file search. Production topology, TLS termination, secret injection, and Atlas settings are not verifiable here. |

## Database and Model Inventory

| Model | Purpose / ownership | Validation, indexes, sensitive/historical notes |
| --- | --- | --- |
| `User` | Account plus store profile; user-level; currently also anchors the owner’s store ID. | Required names, email, mobile, password hash, store name/address; role enum. Email unique; `passwordHash` is `select: false`. No `storeId` membership field. No explicit length constraints. |
| `Product` | Store-level catalog and stock. | Required store/name/category/prices/stock; non-negative numeric minimums; active/archived enum. Per-store partial unique barcode and store/name indexes. SKU has no index/uniqueness. Stock has no integer schema validator. |
| `Sale` | Store-level transaction and item snapshots; cashier ID intended as actor. | Required store/cashier/transaction/items/totals; payment enum; globally unique transaction code and store/date index. Item snapshots preserve product name, unit/cost price, quantity, line total. Transaction code is timestamp-derived and may collide. |
| `InventoryTransaction` | Store + operator movement history. | Store/user/product refs, movement enum and before/after values. Store/date index. Quantity has no integer or movement consistency validator. Current writer records store ID as user ID. |
| `Customer` | Store-level contact and mutable credit data. | Store/name required, non-negative credit/balance defaults, optional mobile/address/utang dates; store/name index. No payment ledger or soft delete. |
| `Supplier` | Store-level business contact. | Store/name required; store/name unique compound index. Product supplier is a string, not a reference. No Purchase model exists. |
| `Expense` | Store-level expense. | Required store/category/description/amount/date; amount min 0; store/date index. No general text bounds or soft delete. |
| `AuditLog` | Authentication/security events; currently not tenant-associated. | Enum event, optional user/IP/user-agent and Mixed metadata; no query indexes. Business mutations are not logged. |
| `EmailVerification` | User-level OTP challenge. | OTP hash required and `select: false`; expiry, attempts, verified, usedAt; user index and TTL on expiry. |
| `PasswordReset` | User-level password-reset challenge. | OTP hash required and `select: false`; expiry, attempts, verified, usedAt; user index and TTL on expiry. |
| Store / Purchase / Utang payment | Not present as distinct models. | Store identity is conflated with owner user; purchase workflows and auditable credit-payment history are not implemented. |

## Compliance Matrix

Status values describe the current source, not the wording of policy documents. Risk uses `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `PASS`, or `NOT APPLICABLE`.

| # / requirement | Status | Evidence and explanation | Risk | Recommended action |
| --- | --- | --- | --- | --- |
| 1. Centralized database connection | PARTIAL | `backend/src/config/database.ts` centralizes `mongoose.connect`; server waits before listening. No graceful shutdown. | MEDIUM | Add lifecycle shutdown and connection event handling. |
| 2. Environment variables and secret hygiene | FAIL | `backend/src/config/env.ts` accepts `MONGODB_URI` and fallback `MONGO_URI`; JWT has a development fallback. `.env.example` is blank. `.gitignore` ignores `.env`; Git shows its removal staged, not committed. Secrets were exposed in supplied attachments. | CRITICAL | Rotate exposed Atlas/email credentials and JWT secret; commit env removal; verify no secret in history; use production secret manager. |
| 3. Atlas configuration | PARTIAL | Connection URL comes from backend env and code has no localhost Mongo fallback. Active env was not read; actual Atlas hostname/database/network/credentials and cluster settings are therefore unverified. | MEDIUM | Verify URI and Atlas authentication, IP restrictions, least privilege, backups, and TLS directly in Atlas without sharing secrets. |
| 4. Model coverage and schema quality | PARTIAL | Ten Mongoose models exist (listed above); no Store, Purchase, or credit-payment model. Several fields lack bounds and strict validation. | HIGH | Design only missing domain models needed for workflows; add constraints after migration/backfill review. |
| 5. Multi-tenant isolation | FAIL | Reads commonly filter by the user ID; creates in `businessController.ts` spread body after `storeId`; updates in business and dashboard controllers `$set` raw body. Client can set or change ownership. No API cross-store test. | CRITICAL | Use database-authoritative membership and explicit write allow-lists; test Store A/B via API. |
| 6. Authentication | PARTIAL | bcrypt hash, cryptographic OTP generation, hashed OTPs, five-minute expiry and attempt fields exist. Token verification trusts embedded claims; logout only audits and does not revoke; resend has controller-level one-minute check. | HIGH | Reload active account/role/membership on auth; add revocation/versioning; make OTP state transitions atomic and rate-limit all OTP endpoints. |
| 7. Authorization / RBAC | FAIL | `requireRole` checks JWT `role`; only admin routes apply it. Business/store routers primarily authenticate without role gates. Admin impersonation issues a seven-day token. | CRITICAL | Treat database user state as authoritative; define endpoint permissions and short, audited impersonation sessions. |
| 8. Database validation | PARTIAL | Several required/enum/min/default constraints exist; missing string bounds, integer stock/quantity checks, strict update field allow-lists, and full amount/date rules. | HIGH | Add schema and DTO validation; ensure update validators and domain constraints on every write path. |
| 9. Data minimization | PARTIAL | User profile stores mobile/store address; customers store optional contact/address and balances. Business necessity/retention of each field is undocumented; no government ID/card fields found. | MEDIUM | Map each personal field to a feature and approved retention need; minimize customer contact fields. |
| 10. Password/secret protection | PARTIAL | Password and OTP hashes are excluded by default, bcrypt is used, and OTP plaintext is sent via email as required. However, admin bootstrap contains a fallback password and prints it; secrets have been exposed in attachments. | CRITICAL | Remove bootstrap defaults/logging; rotate exposed secrets and audit Git history; never log env config. |
| 11. Database indexes | PARTIAL | Store-leading indexes for barcode/name, sale date, customer name, supplier name, expense date, inventory date; OTP TTL indexes. Missing store+SKU/audit indexes; duplicate leading single-field indexes likely due `index:true` plus compounds. | MEDIUM | Review actual Atlas index list/query plans and remove redundancy only through controlled migrations. |
| 12. Barcode/QR system | PARTIAL | Backend barcode/SKU lookup is store-filtered; product barcode uniqueness is per store. Scanner UI currently uses demo data/mock lookup; no QR implementation or live API lookup on scan verified. | MEDIUM | Connect scanner to authenticated API and test cross-store barcode lookup. |
| 13. Inventory integrity | FAIL | Stock-out, stock-in, count, and checkout paths write product and history records separately except checkout’s session. Stock check/write is not atomic; actor written as store ID. | HIGH | Use conditional atomic stock updates and transactions for movement/history/audit; enforce operator identity and movement invariants. |
| 14. Historical sales | PARTIAL | Sale items snapshot product name, unit price, cost price, quantity, and line total; product delete is hard delete but snapshots survive. No discount field or cancellation model. | MEDIUM | Preserve snapshots; add cancellation/return adjustment ledger before supporting those workflows. |
| 15. Customer utang / credit | FAIL | Customer balance and requested/paid timestamps are directly accepted by create/update requests; no customer foreign key on sale, payment model, atomic balance/payment operation, or complete history. | CRITICAL | Remove client control of balance fields; implement a transactional credit/payment ledger and store-scoped role checks. |
| 16. Suppliers | PARTIAL | Supplier records are store-scoped in current queries; create/update bodies can override ownership. No Purchase model/reference; supplier fields are lightly validated. | HIGH | Allow-list fields, preserve tenant ID, add purchase references only with a defined workflow. |
| 17. Expenses | PARTIAL | Queries are store-scoped and amount is checked positive on create; body spread can override store ID, raw body patch can mutate fields; no audit log or explicit date/category rules. | HIGH | Enforce roles and allow-listed validation; audit expense changes. |
| 18. Reports and analytics | PARTIAL | Report aggregation `$match`es the user-derived store ID. Role restrictions are absent for business reports; some all-time aggregates may grow without bounds. | HIGH | Resolve authorized membership, gate roles, bound date ranges and validate report filters. |
| 19. Transactions / atomic operations | PARTIAL | Checkout uses Mongoose session/transaction for sale and stock changes. Stock-in/out/count do not; no Purchase/utang-payment/cancellation transactions exist. | HIGH | Add appropriate transactions/conditional writes for implemented multi-document business operations. |
| 20. Audit logging | PARTIAL | Auth lifecycle events are written to `AuditLog`; business writes, role/admin changes, inventory, and credit/payment actions are not. Audit records lack store/resource fields and indexes. | HIGH | Add tenant-aware structured audit events, actor IDs, safe metadata, and retention/access rules. |
| 21. Query security | PARTIAL | No direct `Model.find(req.query)` pattern found in reviewed controllers; some routes pass raw `req.body` as update operators/fields. | HIGH | Construct filters/updates from validated allow-lists; reject operator-shaped payloads and sanitize database errors. |
| 22. Pagination | FAIL | Product/customer/supplier lists are unbounded; sale/expense lists have fixed limits but no page/cursor interface. Reports include unbounded aggregate ranges. | MEDIUM | Add validated cursor/page and maximum limits; constrain report windows and index matching filters. |
| 23. Soft delete / history | FAIL | Product, customer, supplier, and expense delete handlers physically delete. Sale snapshots protect existing display values, but linked references/history/audit are incomplete. | MEDIUM | Prefer archive/soft-delete for appropriate entities; do not soft-delete every model indiscriminately. |
| 24. Startup safety | FAIL | `ProductModel.syncIndexes()` runs from normal connection startup; can drop schema-undeclared indexes. Auth registration cleanup has `deleteMany`, but that is request compensation, not startup. | HIGH | Remove startup sync; manage indexes with reviewed, explicit migration/deployment steps. |
| 25. Backup and recovery | NOT IMPLEMENTED | No repository evidence can establish whether Atlas backups are enabled, their retention, restore permissions, RPO/RTO, or restore tests; Atlas-side state is not observable from this audit. | HIGH | Verify Atlas plan/config and create an exercised recovery runbook. |
| 26. Data retention | PARTIAL | OTP/reset TTL indexes with five-minute expiry are present; TTL is asynchronous. Business, account, audit, and backup retention periods are undefined; no business data purge is present. | MEDIUM | Set legally reviewed schedules; handle holds and deletion/anonymization through reviewed jobs. |
| 27. Privacy / data protection | PARTIAL | Consent booleans/time are stored and policy text exists; no self-service access/correction/deletion request workflow or operational retention controls verified. Philippine DPA/NPC applicability needs counsel/privacy officer review. | HIGH | Map data subjects, lawful basis, notice, processor contracts, rights requests, incident duties, and NPC obligations with qualified review. |
| 28. Security headers / API security | PARTIAL | CORS allow-list and manual headers; auth rate limit is in-memory and process-local. No Helmet package, centralized request schema validation, or distributed limiter. Production generic error response exists; development returns raw messages. | MEDIUM | Use tested security middleware, bounded body handling, shared rate limiting, and safe error mapping. CORS is not authorization. |
| 29. Frontend security | PARTIAL | No frontend Mongo URI is evidenced; Vite proxies API. Bearer JWT is stored in `localStorage`; UI role state is not a security boundary. Scanner currently mocks product lookup. | HIGH | Keep all authorization backend-side; assess XSS/token theft and prefer secure HttpOnly cookie/session design if compatible. |
| 30. Security testing | FAIL | Five utility tests cover OTP generation/hash, email masking, password policy, and OTP format only. No API auth/RBAC/tenant/integrity/error exposure tests. | HIGH | Add isolated-test-DB API tests; refuse to run against production and exercise forged IDs/roles and concurrent inventory cases. |

## Security and Privacy Controls Verified

- bcrypt password hashes and OTP hashes use `select: false`; normal user response serializers omit hashes.
- OTP generation uses `node:crypto.randomInt`; OTPs are hashed, checked for expiry/attempt limits, and TTL-indexed.
- Registration/login/forgot-password have route-level in-memory rate limits; login also uses account lockout fields. Resend and verification endpoints do not share a distributed limiter.
- Admin routes are protected by a route-level `ADMIN` role check, but that role is taken from JWT claims rather than current database state.
- Manual response headers include content-type sniffing, frame, referrer, permissions, CSP, and production HSTS.
- Legal policy documents and frontend policy modals exist. Their claims about role protections, monitoring, retention, incident response, and deletion exceed some implemented controls; documentation must be reconciled with actual behavior.
- The frontend stores the bearer JWT in `localStorage`, increasing exposure if script execution is compromised.

## Scorecard

Scores are engineering judgments from source evidence, not compliance certifications.

| Area | Score / 10 |
| --- | ---: |
| Database architecture | 6 |
| Database security | 3 |
| Multi-tenant isolation | 2 |
| Authentication | 5 |
| Authorization / RBAC | 2 |
| Data validation | 4 |
| Data integrity | 3 |
| Audit logging | 2 |
| Privacy controls | 3 |
| API security | 4 |
| Performance | 4 |
| Testing | 1 |
| Backup / recovery | 1 |
| Documentation | 3 |
| **Overall** | **43 / 140 (30.7%)** |

**Overall assessment: Critical gaps (0–39%).** The score is not a legal determination or a claim that the platform is compliant.

## Baseline Validation

- `backend`: `npm run build` passed.
- `backend`: `npm test` passed, 5 tests; these are utility-level auth tests only.
- `frontend`: `npm run build` passed.
- `frontend`: `npm run lint` failed with 5 errors: `App.tsx` synchronous effect state update; `AdminPages.tsx` two synchronous effect state updates and a window-location immutability rule; `ScannerPage.tsx` unused caught error variable.
- Atlas connectivity, Atlas IP allow-list, backups, database user permissions, production TLS, and secret manager setup were not tested or verifiable in this source-only audit.

## Immediate Decisions

1. Rotate Atlas, email-provider, and JWT secrets that were exposed; keep replacement values out of chat and source control.
2. Complete and review the staged removal of `backend/.env`; inspect Git history and rotate secrets even if the removal is committed.
3. Approve a minimal P0 remediation scope for authorization/tenant-write controls and removal of startup `syncIndexes()` before any broader redesign.
4. Do not enable staff roles until membership assignment is enforced and tested.
5. Do not treat the customer outstanding-balance field as an auditable accounting ledger.