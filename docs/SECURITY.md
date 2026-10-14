# Security

## Trust boundaries

- The browser is untrusted. Session cookies are the only browser-held credential for the web app.
- User id, role, credit balance, prices, storage keys, and object paths supplied by the client are ignored.
- Provider API keys, payment server keys, and SMTP credentials exist only in server environment variables.
- Object storage is private. Downloads use short-lived presigned GET URLs issued after an ownership check.

## Authentication

- Better Auth sessions in PostgreSQL.
- HttpOnly, Secure, SameSite cookies. `BETTER_AUTH_SECRET` required in all non-test environments.
- Email verification required before billable jobs in production.
- Password reset tokens are single-use and time-limited (Better Auth verification table).
- Google OAuth enabled only when client id/secret are present. Redirect URI is server-configured.
- Session validation happens in server components, route handlers, and server actions. Cookie existence checks in middleware/proxy are not authorization.

## Authorization

Roles: `user`, `admin`.

- User: own projects, assets, jobs, billing, profile.
- Admin: user list, credit adjust, provider toggles, jobs (all tenants), payments, settings.
- Admin UI and `/admin/*` APIs re-check `user.role === "admin"` on every request.
- IDOR tests must attempt cross-user asset, job, and project access.

## Uploads

1. Client requests an upload slot with declared MIME and size.
2. Server rejects disallowed MIME, extension, or size vs `MAX_UPLOAD_BYTES`.
3. Server generates `storageKey = users/{userId}/uploads/{uuid}` (no user filename in the path).
4. Client PUTs to a short-lived presigned URL.
5. Worker or completion endpoint downloads the object, checks magic bytes (file-type), decodes with Sharp bounded by `MAX_IMAGE_PIXELS` and `MAX_IMAGE_EDGE_PX`, strips EXIF, and only then creates `Asset`.
6. Failed validation deletes the object. Quotas: `STORAGE_QUOTA_BYTES` per user.

Path traversal is impossible if keys are always server-generated UUIDs under a user prefix. Asset GET checks `asset.userId === session.user.id` (or admin).

## SSRF

Workers fetch provider result URLs only when the hostname is on an allowlist for that adapter (OpenAI, Google, Fal). User-supplied URLs are not fetched. Presigned upload URLs are not passed to providers; the worker copies bytes or uses a short-lived GET it created.

## Payments

- Verify Midtrans `signature_key` and Stripe `Stripe-Signature`.
- Idempotent webhook table.
- Do not grant credits on redirect.
- Amount and credit pack are loaded from our `Payment` row, not from the webhook's untrusted product name.

## Web security headers (Next.js)

- `Content-Security-Policy` default-src self; img-src self blob: data: and the storage host; connect-src self and required APIs.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` camera/microphone geolocation off
- HSTS in production

CSRF: same-site cookies plus Better Auth's CSRF handling on its routes. Extra origin checks on mutation route handlers.

## Rate limiting

Redis sliding window:

- Auth routes (login, register, forgot password)
- Upload slot creation
- Job enqueue per user
- Public API per key (when enabled)

## Logging and secrets

Never log: API keys, passwords, session tokens, `Authorization` headers, presigned URLs, full image payloads, webhook raw signatures.

Do log: request id, user id, job id, provider slug, normalized error code, latency.

## Public API (later)

- Keys shown once, stored as SHA-256 hashes plus a prefix.
- Scoped permissions.
- `X-Request-Id` generated if missing.
- Same credit and ownership rules as the web app.

## Abuse and cost

- Per-user job concurrency.
- Provider RPM limits.
- Daily provider budget (estimated USD).
- `AI_JOBS_ENABLED` kill switch.
- Admin can disable a provider or model instantly via registry flags.

## Privacy

- Account data export: JSON of profile, projects metadata, job metadata, ledger.
- Account deletion: schedule purge of assets from storage, revoke sessions/keys, anonymize PII. Financial ledger retained as required.
- Configurable asset retention.

## Testing that must exist before calling the system secure

- AuthN / AuthZ
- Cross-tenant asset and job access
- Upload magic-byte rejection
- Credit reservation under concurrency
- Duplicate webhook
- Invalid payment signature
- Admin-only routes as a normal user
