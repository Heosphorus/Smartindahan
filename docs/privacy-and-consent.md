# Privacy, consent and account data

How smarTindahan shows its policies, records agreements, and handles data requests. **This describes what the code does. It is not legal advice, and implementing these features does not make the service compliant with the Data Privacy Act of 2012 (RA 10173) or any other law.** See [Owner decisions](#owner-decisions-and-legal-review-before-launch).

## Where the policies are shown

| Place | What |
| --- | --- |
| `/terms`, `/privacy` | Public pages (no account needed). `?version=<id>` shows an older version. Each has a section list, version, effective date, draft banner and version history. |
| Registration | One unchecked checkbox with links to both pages (they open in a new tab so the form is not lost). |
| Login screen | Footer links. |
| Signed-in app | Footer links on every page; Settings → Privacy and security. |
| After a policy change | A review screen (Terms) or a notice banner (Privacy Policy). |

Text in `[square brackets]` is highlighted as a placeholder or open decision. Nothing in brackets is a real fact.

## Policy versions

Each version is one immutable document in the `policyversions` collection: type (`terms` or `privacy`), version id, title, summary, `changeSummary`, sections, `isDraft`, `publishedAt`, `effectiveAt`, `requiresReacceptance` and a SHA-256 `contentHash`. "Current" is the newest version whose `effectiveAt` has passed; it is computed, not stored, so it cannot drift.

The API refuses to edit or delete a published version (Mongoose guards in `models/immutable.ts`, plus a unique `(type, version)` index). Direct database access can still change data, so restrict who has it.

The first draft of each policy is inserted automatically the first time it is needed, only if that type has no versions yet. The text lives in [`backend/src/legal/initialPolicies.ts`](../backend/src/legal/initialPolicies.ts).

### Publishing a new policy version

An `ADMIN` account calls the API (there is no admin screen for this yet):

```bash
curl -X POST "$API/api/auth/admin/policies" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "policyType": "terms", "version": "1.1", "title": "Terms of Service",
    "summary": "…", "changeSummary": "What changed, in plain words.",
    "sections": [{ "id": "what-it-is", "heading": "1. What it does", "paragraphs": ["…"], "bullets": [] }],
    "isDraft": false, "requiresReacceptance": true,
    "effectiveAt": "2027-01-15T00:00:00Z"
  }'
```

- A version that already exists returns `409`; choose a new number.
- `effectiveAt` cannot be in the past, so a publication never rewrites what users were shown. Schedule it in the future to give notice.
- Set `requiresReacceptance: false` for corrections that do not change meaning; users who accepted an earlier version are not asked again.
- Every publication is written to the audit log (`POLICY_PUBLISHED`).

## Consent records

`consentrecords` is an append-only ledger. A record is created only when the user performs the action:

| Field | Meaning |
| --- | --- |
| `userId` | The account. |
| `consentType` | `TERMS_OF_SERVICE` (accepted a contract) or `PRIVACY_NOTICE` (acknowledged the notice). Acknowledging a notice is **not** treated as consent to processing. |
| `policyVersion` | The version id that was shown and accepted. |
| `accepted`, `acceptedAt` (UTC) | Always `true`; the time of the action. |
| `source` | `REGISTRATION`, `REVIEW_PROMPT` or `SETTINGS`. |
| `withdrawnAt` | Reserved for future optional consents. |

No password, code, token, IP address or user-agent is stored in it (the audit log keeps IP and user-agent separately, see below). The application cannot update or delete these records. Existing accounts created before this feature have **no** records; they are asked to accept, and nothing is back-filled on their behalf.

### Registration

1. The page loads the current versions and shows the checkbox unchecked.
2. The server rejects registration (`400 AGREEMENT_REQUIRED`) unless `termsAccepted` and `privacyPolicyAccepted` are exactly `true`. The checkbox is only a convenience.
3. The request must carry the `termsVersion` and `privacyVersion` the user saw; if either is not the current version the server answers `409 POLICY_VERSION_MISMATCH` and the page reloads the new versions and asks again.
4. Inside one database transaction the user, both consent records and the verification code are created, then the email is sent. If anything fails (including email delivery) the transaction is aborted, so there is no account and no acceptance record. (This needs a MongoDB replica set, as everywhere else in the app.)

### When a policy changes

- **Terms (`requiresReacceptance: true`)**: signed-in users get `403 POLICY_REVIEW_REQUIRED` from store and business routes until they accept. The app shows a review screen that lists what changed, links to the full text and asks for an unchecked-by-default box. Continued use is never treated as acceptance. The screen also offers sign-out, data download and account deletion, which are never blocked.
- **Privacy Policy**: shown as a notice banner with an "I have read" button. It does not block anything, because a notice is information, not a contract.
- Users who accepted any earlier version are only prompted if a version published since then has `requiresReacceptance: true`.
- Admin accounts are not asked to accept customer terms.

### Optional marketing consent

**Not implemented, on purpose.** The application sends no marketing or promotional messages, so there is nothing optional to consent to, and the Privacy Policy says so. If marketing is added later, add a separate `MARKETING_EMAIL` consent type (unchecked, optional, withdrawable in settings) and keep security emails separate.

## Account settings (Settings → Privacy and security)

| Feature | How it works |
| --- | --- |
| Account details | Name, contact number, store name and address are edited in the existing profile forms. **Email cannot be changed by the user**; they send a correction request. |
| Password | "Change password" (current password required; other devices are signed out). |
| Agreements | Shows the user's own consent history with links to the exact versions. |
| Download my data | `GET /api/privacy/export` returns a JSON file: account, consent records, privacy requests, security events and the store's products, sales, inventory movements, customers, suppliers and expenses. Scoped to the signed-in user; never includes password hashes, codes or tokens. Capped at 50,000 records per collection (the file says if truncated). Rate-limited and audited. |
| Privacy requests | `POST /api/privacy/requests` (type + message up to 1,000 characters). Stored in `privacyrequests`; the user sees only their own. Admins list and update them with `GET /api/auth/admin/privacy-requests` and `PATCH /api/auth/admin/privacy-requests/:id` (status and note); there is no admin screen yet. Replying to the user by email is manual. |
| Close account | See below. |

### Account deletion

1. The user opens "Close my account…", reads what will happen, enters their password and types `DELETE`.
2. The server re-checks the password, then sets `deletionRequestedAt` and `deletionScheduledFor` (now + `ACCOUNT_DELETION_GRACE_DAYS`, default 14). Nothing is deleted yet; the user can keep using the app and can cancel at any time.
3. **The owner must schedule** `npm run purge-deleted-accounts --prefix backend` (daily is sensible; for example a GitHub Actions cron or Vercel Cron running it against the production database). It permanently deletes, in one transaction per account: the user, products, sales, customers, suppliers, expenses, inventory movements, verification/reset codes and privacy requests.
4. Kept after deletion: consent records and audit logs (no secrets), so agreements and security events stay auditable. **They have no automatic expiry yet**; define a retention period.
5. Backups are controlled by the database provider; deleted data can remain in backups until they expire.
6. Admin accounts cannot be closed through this flow.

## Visit analytics

The front end renders `<Analytics />` from `@vercel/analytics/react` (in `App.tsx`). It sends page views to Vercel Web Analytics only when served from Vercel, and the Privacy Policy discloses it. You must enable Web Analytics in the Vercel project (Analytics tab) for data to appear. Because policies are immutable versions, a database that already holds `1.0-draft` keeps the old text; publish a new version if that text was ever shown to real users. Counsel should confirm whether this needs notice or a lawful-basis entry beyond what the policy says.

## Authentication and sessions (what was evaluated and kept)

- **Passwords:** bcrypt, cost 12 (salted). Argon2id would also be acceptable, but needs a native module that complicates the Vercel build; bcrypt at this cost is a justified, widely reviewed choice. Revisit if you move off serverless.
- **Sessions:** signed JWT bearer tokens, 7 days, sent in the `Authorization` header and kept in `localStorage`. No cookies are used, so there is no CSRF surface and no `SameSite` decision; the cost is that an XSS bug could read the token (the app renders no raw HTML; note that the static front end does not yet send a Content-Security-Policy header, which would add defence in depth). Moving to HttpOnly cookies is not recommended for the GitHub Pages + Vercel split because it needs cross-site cookies; it is a reasonable change if you host everything on one domain.
- **Revocation:** every token has a unique id (`jti`). Logout stores it in `revokedtokens` (removed automatically after expiry), so a signed-out token stops working immediately while other devices stay signed in. Password change/reset and an administrator's change bump `tokenVersion`, which signs out every device. Tokens issued before this change have no `jti` and are rejected, so everyone signs in once more after deployment.
- **Brute force:** per-IP rate limits (register 5, login 10, code checks 10, resend 3, forgot 5, reset 5, change-password 5 per 15 minutes; export 5, deletion 5, requests 10 per hour); 5 wrong passwords lock an account for 15 minutes; verification and reset codes allow 5 attempts and last 5 minutes. The rate-limit counters are in memory per server instance (see README limitations). Unknown-email logins spend the same time as real ones and return the same response; password-reset responses are identical for unknown emails.
- **Authorization:** every store route derives the store from the verified token, and the tenant-isolation tests cover cross-store access. Privacy routes always act on the token's own user.
- **Audit log (`auditlogs`):** append-only. Events include sign-in success/failure, registration, email verification, password changes, consent recorded, policy published, data export, deletion requested/cancelled/performed, privacy request submitted/updated, and stock/record changes. It stores user id, event, time, IP address, user-agent and small metadata (never passwords, codes or tokens). No end-user endpoint reads it (users only see their own events inside their export); there is no admin viewer yet, so access is through the database.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ACCOUNT_DELETION_GRACE_DAYS` | Waiting period before deletion (default 14, `0` = purge at the next run). |
| `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_URL`, email settings | As in the README; no new secrets are needed. |

Also run `npm run create-indexes --prefix backend` after deploying: it adds indexes for the new collections (policy versions, consent records, privacy requests, revoked tokens).

## What is still manual or missing

- Schedule the account purge job (nothing deletes accounts until it runs).
- Retention job for consent records, audit logs and old privacy requests.
- Admin screens for publishing policies, handling privacy requests and reading audit logs (APIs exist; no UI).
- Email notices when a password changes or a deletion is requested (none are sent today).
- Self-service email change; only a manual request is available.
- Email sending of replies to privacy requests.
- Automated cleanup of backups (provider settings).

## Owner decisions and legal review before launch

Information only the owner can supply (the policies show it as highlighted placeholders):

- Legal business/operator name, business address
- Privacy contact email and support/security contact
- Whether a Data Protection Officer or other formal arrangement is required, and who it is
- Minimum age
- Actual hosting and database regions
- The email provider actually used (Resend or SMTP)
- Retention periods (consent records, audit logs, backups), grace period, response time for privacy requests
- Dispute-resolution wording and venue

Questions for qualified Philippine privacy counsel:

- Lawful basis for each processing activity (do not rely on consent for everything), and the exact privacy-notice content required
- Whether smarTindahan is a personal information controller, a processor, or both (store owners enter their customers' and suppliers' data)
- National Privacy Commission registration or notification duties, and breach-notification procedure and deadlines
- Cross-border transfers (provider regions) and any agreements needed with providers
- Retention duties for business, tax and financial records, and whether the operator must keep anything after account closure
- Whether the draft limitation-of-liability, governing-law and dispute terms are enforceable
- Whether sensitive or children's data can be entered and what that requires
