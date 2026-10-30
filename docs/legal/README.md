# smarTindahan legal and security documentation

**Status: draft. Nothing here has been reviewed by the platform owner or by Philippine legal counsel, and none of it is a statement of legal compliance.**

## Where the user-facing policies live

The Terms of Service and Privacy Policy that users see are **versioned records in the database**, served by the API and shown at `/terms` and `/privacy`. Their initial text is in [`backend/src/legal/initialPolicies.ts`](../../backend/src/legal/initialPolicies.ts). The old `privacy-policy.md` and `terms-of-service.md` files in this folder were replaced by pointers so there is only one source of truth.

How versions, consent records, re-acceptance, data export and account deletion work: [../privacy-and-consent.md](../privacy-and-consent.md).

## Internal summaries in this folder

These are short internal descriptions of controls, not user-facing policies. They are accurate to the code as of this change but are not legally reviewed:

- [Cookie Policy](./cookie-policy.md) (the app sets no cookies; covered in section 3 of the Privacy Policy)
- [Security Policy](./security-policy.md)
- [Data Retention](./data-retention.md)
- [Data Breach Response](./breach-response.md)
- [Access Control Policy](./access-control-policy.md)
- [Audit Logging Policy](./audit-logging-policy.md)

Review them whenever the service changes materially and at least once a year.
