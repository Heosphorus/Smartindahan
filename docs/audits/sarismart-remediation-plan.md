# SariSmart Security Remediation Plan

This plan follows the repository audit in `docs/audits/sarismart-audit.md`. The first source remediation pass is implemented; the entries below distinguish completed controls from outstanding work. Operational secret rotation and production configuration still require the account owner.

## Implemented in Current Worktree

- JWT authentication reloads active, verified user/role state from MongoDB and enforces token-version invalidation.
- Store/business routes are owner-only until a staff membership workflow exists; server-derived owner context scopes access.
- Product, customer, supplier, expense, and settings writes use allow-listed fields; customer balance and utang dates cannot be set through these CRUD APIs.
- Checkout, stock-in, stock-out, inventory count, initial stock history, and their core audit records use Mongoose transactions with authenticated actor IDs.
- Normal startup no longer calls `syncIndexes`; production auto-index creation is disabled and an explicit additive `create-indexes` task is available.
- API list endpoints use bounded page/limit pagination; generic errors are sanitized; JSON bodies are capped; authenticated 401 responses clear the frontend token and return to sign-in.
- Product/customer/supplier/expense removal is archival; password changes revoke prior JWTs; admin impersonation is short-lived and audited.
- Admin bootstrap no longer has a default password, does not print the password, validates strength, and reuses the centralized connection.
- Added field allow-list/pagination tests and an API tenant test that requires an isolated test-named `MONGODB_TEST_URI`.
- Fresh validation: backend build passed; 9 tests passed and 1 isolated-database API test skipped; frontend lint and build passed.

The skipped API test and transaction/concurrency checks still require a dedicated replica-set test database. This is not proof of production compliance.

## P0 — Critical

| Finding | Minimal remediation | Files likely involved | Complexity / verification |
| --- | --- | --- | --- |
| Store ownership can be forged in create/update payloads. | Resolve authorized store membership server-side, then build create/update objects from explicit writable fields. Reject attempts to mutate immutable ownership. Scope every resource update/delete by both resource ID and authorized store ID. | `backend/src/middleware/authMiddleware.ts`, `backend/src/controllers/businessController.ts`, `backend/src/controllers/dashboardController.ts`, `backend/src/controllers/operationsController.ts`, route files | Medium. API tests for two stores must prove list/get/create/update/delete isolation and forged `storeId` rejection. |
| Role and active/verified state come from stale JWT claims. | Verify token identity, reload active user from MongoDB, derive role and store membership from the database, and reject unassigned staff. Define least-privilege route gates. | `backend/src/middleware/authMiddleware.ts`, `backend/src/models/User.ts`, `backend/src/routes/*.ts` | Medium. Test forged roles, deactivated accounts, demotions, missing membership, and each role/action pair. |
| Secrets were disclosed and env file remains in current committed revision pending staged deletion. | Rotate Atlas, Resend/email, JWT, and any other exposed secrets; verify `.env` is untracked in the intended commit and inspect history. Keep actual values out of report and logs. | `.gitignore`, `backend/.env.example`, repository Git history, deployment secret settings | Low-to-medium operational work. Verify index removal and secret rotation without displaying values. |
| Automatic `syncIndexes()` can remove undeclared production indexes at server startup. | Remove automatic synchronization. Use a reviewed index migration/operation that only adds or intentionally changes indexes, with staging first. | `backend/src/config/database.ts`, add explicit migration tooling only after approval | Low code complexity, high operational care. Inspect actual Atlas indexes and test migration in staging; do not run destructive commands during this audit. |

## P1 — High

| Finding | Minimal remediation | Files likely involved | Complexity / verification |
| --- | --- | --- | --- |
| Inventory mutations are not atomic and checkout actor attribution is incorrect. | Use transaction/session or conditional atomic updates for quantity and movement record. Record authenticated operator ID, not tenant ID. Add idempotency/concurrency behavior. | `backend/src/controllers/operationsController.ts`, `backend/src/models/InventoryTransaction.ts`, `backend/src/models/Sale.ts` | Medium. Replica-set-backed integration tests for oversell races, rollback, actor, and movement records. |
| Customer credit is body-controlled and has no payment ledger. | Prevent ordinary customer create/update from setting outstanding balance or utang timestamps. Define customer reference and append-only credit/payment entries; update balance atomically with each entry. | `backend/src/models/Customer.ts`, add approved credit-ledger model, `backend/src/controllers/businessController.ts`, `operationsController.ts` | High. Requires product/accounting decisions and migration of existing balances. Tests for payments, reversals, limits, and cross-store access. |
| OTP state transitions and resend limits are not atomic/distributed. | Use atomic attempt/consume transitions; apply shared rate limiting by IP/account; invalidate prior challenges safely. Preserve short expiry and hashed codes. | `authController.ts`, OTP models, rate-limit middleware | Medium. Concurrency, expiry, reuse, brute-force, and multi-instance tests. |
| Admin account tools are overpowered and weakly audited. | Validate admin target IDs and inputs, apply common password-strength rules, revoke sessions on changes, require a short-lived explicitly scoped impersonation token, and audit actor/reason. Remove default password/logging from bootstrap. | `adminController.ts`, `createAdmin.ts`, `User.ts`, audit model | Medium. Admin authorization and session invalidation tests. |
| Physical deletes discard business history. | Archive products/customers/suppliers where appropriate; preserve referenced historical sales and outstanding-credit customers. Add restore/visibility semantics deliberately. | Models and business/dashboard controllers | Medium. Migration/backfill plus history preservation tests. |
| Sensitive or financially relevant business mutations are not audited. | Add structured tenant/user/resource audit events with allow-listed metadata; never log secrets, OTPs, or unnecessary customer PII. Couple audit write to transaction where critical. | `AuditLog.ts`, auth/business/dashboard/operations/admin controllers | Medium. Verify each event and metadata redaction. |
| Secret defaults are unsafe for production. | Validate required production env at startup, remove JWT fallback in production, centralize secrets in deployment secret manager, and keep DB access least-privileged. | `config/env.ts`, `config/database.ts`, deployment configuration | Low-to-medium. Negative startup tests without connecting or printing secrets. |
| Bearer token uses localStorage. | Evaluate migration to Secure, HttpOnly, SameSite cookies with CSRF controls, or formally accept/document XSS exposure with strong CSP and short token lifetime. | Frontend auth/API clients and Express session/cookie handling | Medium. Threat-model and browser integration tests required; approval needed because it changes session behavior. |

## P2 — Medium

| Finding | Minimal remediation | Files likely involved | Complexity / verification |
| --- | --- | --- | --- |
| Missing field lengths, numeric integer rules, date/category constraints. | Add authoritative schema/DTO validations and test invalid data; use update validators consistently. | Mongoose models and controllers | Medium. Schema/API tests and compatibility review for existing records. |
| Unbounded product/customer/supplier lists and all-time report scans. | Introduce validated cursor/page parameters, enforce max page size, constrain report range, add indexes only after query-plan review. | Business/dashboard controllers and frontend API services | Medium. Large-fixture tests and explain-plan review. |
| Audit and compound index design has potential redundancy and omissions. | Inspect actual Atlas indexes and workload; document duplicate leading indexes; add audit/SKU indexes only if query use justifies them. | Model definitions, controlled index migration | Medium operational risk. Staging index builds and explain results. |
| Error handling can return controller messages or raw caught messages. | Map validation, duplicate-key, not-found, and infrastructure errors to safe stable API messages; keep sanitized server diagnostics. | `server.ts`, controllers | Medium. Production-mode response tests with representative Mongoose errors. |
| In-memory rate limiters are process-local and unbounded in key cardinality. | Adopt a shared limiter/store appropriate to deployment; bound cleanup and trust proxy configuration. | `rateLimitMiddleware.ts`, auth routes, server config | Medium. Multi-instance rate-limit tests. |
| Scanner UI is mock-backed despite a tenant-scoped lookup API. | Connect scanner/manual lookup to the authenticated store endpoint and cover camera/manual error states. | `ScannerPage.tsx`, scanner service/API | Medium. UI/API tests, including cross-store barcode lookup. |
| Legal/policy text overstates implementation. | Reconcile user-facing claims with actual controls; have qualified privacy counsel review Philippine Data Privacy Act/NPC obligations and notices. | `docs/legal/*`, policy modal, privacy workflows | Medium. Document approval and operational rights-request tests. |
| Missing graceful shutdown/connection telemetry. | Close HTTP and Mongoose on SIGINT/SIGTERM; handle driver connection events without logging URI. | `backend/src/server.ts`, `config/database.ts` | Low. Process lifecycle tests. |

## P3 — Low / Future

- Add backend lint/type-quality checks and resolve current frontend ESLint errors.
- Establish a dedicated test environment and seed fixtures; enforce that test URIs differ from production and clearly identify the test database.
- Review use of MongoDB driver dependency at repository root; frontend package does not establish direct DB access, but unused dependencies should be removed only after checking imports and scripts.
- Add audit-log read policy, retention/archival, and monitoring/alerting after role and tenant design is settled.
- Add API contract documentation and operational runbooks for restore, secret rotation, incident response, and index migrations.

## Approval Boundary

The audit and plan documents are complete. No functional remediation is included in this audit deliverable. Before implementation, approve at least the P0 scope and decide:

1. Whether the single-owner-as-store model remains, or SariSmart needs a distinct `Store` plus membership collection.
2. Which owner/manager/cashier operations are intended and how staff membership is provisioned/revoked.
3. The required customer credit/payment ledger semantics and migration policy for existing balances.
4. The session storage approach and acceptable token lifetime.
5. The staging/test MongoDB URI, which must never target production.

No production database migration or destructive index/data operation should be run without a reviewed migration plan and backup/restore verification.