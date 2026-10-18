# smarTindahan legal and security documentation

This folder contains baseline policies and operational guidance for the smarTindahan platform.

## Included policies

- [Privacy Policy](./privacy-policy.md)
- [Terms of Service](./terms-of-service.md)
- [Cookie Policy](./cookie-policy.md)
- [Security Policy](./security-policy.md)
- [Data Retention Policy](./data-retention.md)
- [Data Breach Response Policy](./breach-response.md)
- [Access Control Policy](./access-control-policy.md)
- [Audit Logging Policy](./audit-logging-policy.md)

## Implementation status

The application includes the following controls in code:

- hashed password storage with bcrypt
- email verification and reset code flows
- IP-based rate limiting for authentication actions
- JWT-based authenticated access
- role-based route restrictions
- audit logging for security events
- strict HTTP security headers and CORS settings
- policy acknowledgement at account registration

## Review cadence

Review these documents at least once every 12 months and update them whenever the service changes materially.
