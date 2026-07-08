# Tenant Security Foundation Plan

SignalGrid v0.2 should establish tenant and authorization boundaries before adding any real connector path.

## Requirements

- Every customer-owned row includes `tenant_id`.
- Every DB-backed route is tenant-aware.
- No object lookup by ID occurs without tenant context.
- Public-safe mode uses an explicit demo tenant with synthetic fixtures only.
- Production auth is future work and must not be implied by the public Review Hub.
- RBAC separates owner/admin, operator, auditor, and read-only reviewer capabilities.
- Audit events record tenant, actor or system, action, target, decision/evidence reference, timestamp, and request correlation.
- Rate limiting protects API routes and connector-trigger endpoints.
- Input validation rejects malformed route params, request bodies, connector payloads, and policy definitions.
- Logs are PII-safe by default and avoid secrets, tokens, tenant IDs from real environments, customer data, PHI, and PII.

## Authorization rules

- Tenant context is resolved before data access.
- Role checks happen before sensitive actions.
- Cross-tenant reads and writes are denied by default.
- Missing tenant context fails closed for protected routes.
- Demo tenant bypasses are not allowed in code paths intended for private or production contexts.
