# Data retention (internal summary)

What the code does today, and what the owner still has to decide. User-facing wording: Privacy Policy, section 8.

| Data | Behaviour today | Owner decision needed |
| --- | --- | --- |
| Active account and store records | Kept while the account is open. | — |
| Verification and reset codes | Hashed; expire after 5 minutes; removed by a MongoDB TTL index. | — |
| Revoked session identifiers | Kept until the token would have expired; removed by a TTL index. | — |
| Closed accounts | Deletion is scheduled after `ACCOUNT_DELETION_GRACE_DAYS` (default 14). `npm run purge-deleted-accounts` then deletes the account, store records and privacy requests. **The command must be scheduled.** | Confirm grace period; schedule the job. |
| Consent records and audit logs | Kept after account deletion (no passwords or codes). **No automatic expiry.** | Retention period (proposal: 24 months) and a TTL/cleanup job. |
| Backups | Controlled by the database provider. | Backup retention and what "deleted" means for backups. |
| Records other laws require businesses to keep | The platform deletes a closed account's records; the user can export first. | Counsel to confirm whether any record must be retained by the operator. |
