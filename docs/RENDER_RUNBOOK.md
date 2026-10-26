# Render staged deployment runbook

This is an operator checklist. No step here is executed by CI or by `pnpm preflight`. `render.yaml` is a Blueprint definition only. Do not provision, migrate, deploy, or run live smokes without explicit authorization.

## Checkpoints

### 1. Confirm the Render account and service ownership

Dashboard only. Confirm the workspace, billing account, and who can create Blueprints. Record the intended service names (`pixelforge-web`, `pixelforge-worker`, `pixelforge-postgres`, `pixelforge-redis`) and the environment group `pixelforge-secrets`. Stop if ownership is unclear.

### 2. Provision or verify PostgreSQL

Dashboard or existing managed Postgres 16. The Blueprint plan is `basic-256mb` — confirm that plan and backups before create. Do not drop or recreate a database that already holds user data. Save `DATABASE_URL` only in the secret store. Local `prisma migrate deploy` against production is not authorized by this document.

### 3. Provision or verify Redis

Dashboard Render Key Value (`pixelforge-redis`) or another Redis 7 compatible broker. Web and worker must receive the same `REDIS_URL`. Treat Redis as disposable; `AIJob` rows and credit reservations live in PostgreSQL.

### 4. Configure private S3-compatible storage

External to Render (R2, AWS S3, or hosted MinIO). Create a private bucket. Do not use a Render disk. Fill `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. Confirm the bucket is not world-readable. Do not put a test object that contains production user data.

### 5. Configure environment groups and service-specific secrets

Create `pixelforge-secrets` in the dashboard. Use [ENV_MATRIX.md](./ENV_MATRIX.md). Web and worker must share database, Redis, S3, provider keys, `APP_URL`, and `AI_JOBS_ENABLED`. Set `AI_JOBS_ENABLED=false` until checkpoint 9 passes. Leave `STRIPE_*` / `MIDTRANS_*` empty unless a later payments slice is approved. Never commit values.

### 6. Verify Blueprint configuration

Review `render.yaml` against the dashboard: Docker web (`Dockerfile`, health `/api/health`), Docker worker (`Dockerfile.worker`), Postgres 16, Key Value. Confirm there are no extra duplicate services. Applying the Blueprint is a dashboard action and is not done by this runbook.

### 7. Run the approved database migration procedure

Only after a human approves the target database. From a Render one-off/shell on that environment, not from a laptop pointed at production by accident:

```bash
pnpm prisma migrate deploy
```

Expected: the four repository migrations apply (or report already applied). Do not run `prisma migrate reset`, `db push --force-reset`, or `db:seed` on a database that already has users. Preflight only checks that migration folders exist.

### 8. Deploy to a non-production environment first where feasible

Prefer a Render preview or a separately named staging Blueprint. Same image, different secret group, different Postgres/Redis/bucket. Do not point staging at the production bucket.

### 9. Verify health checks and worker startup

```bash
curl -fsS "$APP_URL/api/health"
curl -fsS "$APP_URL/api/health/ready"
```

Expect JSON with `ok`, `service` / `postgres` / `redis` / `storage`, and `timestamp` only. Worker logs should show `PixelForge worker started` with `queueAttached: true` and later `worker heartbeat`. SIGTERM should log `Worker shutting down` without a crash loop. If Redis is down, ready returns 503 and the worker logs that it is not consuming.

### 10. Run authorized live provider smoke tests

Follow [LIVE_SMOKE.md](./LIVE_SMOKE.md). Skip this checkpoint until paid calls are authorized. A skipped suite is not live verification.

### 11. Verify upload, processing, download, and credit settlement

Signed-in staging user with granted test credits (`grantCredits` has no HTTP route; use an approved admin/seed path). Upload an owned image, enqueue one cheap job, confirm the asset is private, download works, and the ledger shows one `reserve` and one `settle` (or one `release` on a deliberate terminal failure). Confirm a second process of the same job does not settle twice.

### 12. Approve production rollout only after all required checks pass

Required before production: checkpoints 1–9 and 11. Checkpoint 10 is required only if the production environment will call live providers on day one. Record the approver and the git SHA that was deployed. Set `AI_JOBS_ENABLED=true` only then.

## Local readiness commands (not a deploy)

```bash
pnpm preflight
pnpm preflight --connect   # local Postgres/Redis only
pnpm lint && pnpm typecheck && pnpm test && pnpm build
git diff --check
```
