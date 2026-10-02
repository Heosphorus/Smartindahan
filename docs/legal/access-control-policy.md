# Access Control Policy

## Principle

Access is granted on a least-privilege basis. Users should only have the permissions needed to perform their assigned role.

## Role model

- ADMIN: full platform oversight and account administration
- STORE_OWNER: store-level management and configuration
- STORE_MANAGER: operational oversight
- CASHIER: transaction handling

## Enforcement

Protected API routes are validated through JWT authentication and role checks before allowing access to store or admin features.
