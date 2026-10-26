# Render deployment checklist

`render.yaml` is a Blueprint. It does **not** mean production services exist. Do not deploy until explicitly authorized. Do not put secret values in this file, git, logs, or client bundles.

## Blueprint services (defined, not verified live)

| Service | Type | Notes |
| --- | --- | --- |
| `pixelforge-web` | Docker web | `Dockerfile`, health `GET /api/health`, binds `PORT` |
| `pixelforge-worker` | Docker worker | `Dockerfile.worker`, `pnpm worker` |
| `pixelforge-postgres` | Render Postgres 16 | `basic-256mb` in the Blueprint; confirm plan before create |
| `pixelforge-redis` | Render Key Value | BullMQ broker |

No extra web/worker duplicates. Object storage is **not** a Render disk: production must use S3-compatible storage (`S3_*`). Render disks are ephemeral.

## Env group `pixelforge-secrets` (both web and worker)

| Variable | Service | Secret? |
| --- | --- | --- |
| `APP_URL` | web (+ worker if generating links) | no |
| `BETTER_AUTH_SECRET` | both | yes |
| `BETTER_AUTH_URL` | web | no (public origin) |
| `S3_ENDPOINT` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | both | yes for keys |
| `S3_REGION` `S3_FORCE_PATH_STYLE` | both | no |
| `OPENAI_API_KEY` | worker (web if enqueue-time provider check) | yes |
| `FAL_KEY` | both | yes |
| `STABILITY_API_KEY` | both | yes |
| `AI_JOBS_ENABLED` | both | no |
| `EMAIL_*` / `RESEND_API_KEY` | web | yes |
| `STRIPE_*` / `MIDTRANS_*` | web when payments exist | yes |

Blueprint-wired (not in the secret group): `DATABASE_URL`, `REDIS_URL`, `NODE_ENV=production`.

Local readiness (does not create Render resources): `pnpm preflight` and, against a local or explicitly approved database/Redis, `pnpm preflight --connect`. See [ENV_MATRIX.md](./ENV_MATRIX.md) and [RENDER_RUNBOOK.md](./RENDER_RUNBOOK.md).

## Commands (after a human creates the Blueprint)

```bash
# one-off / shell on the web service, once per environment
pnpm prisma migrate deploy
pnpm db:seed   # only if empty; do not re-seed production casually

curl -fsS "$APP_URL/api/health"
curl -fsS "$APP_URL/api/health/ready"
```

Worker start: `pnpm worker` (see `Dockerfile.worker`). Recover stuck `queued` jobs with `processJob(jobId)` or a later enqueue using the same BullMQ `jobId`. Redis flush does not delete PostgreSQL jobs or credit reservations.

## Outstanding external configuration

- Render account + Blueprint apply (not done in Phase 4.8)
- Secret group values
- S3/R2/MinIO bucket and IAM
- Provider API keys with billing enabled if live jobs are required
- Custom domain / TLS
- Confirm Postgres plan and backups
- Confirm worker logs show a heartbeat after deploy

Do not claim a Render PASS until those health checks return 200 from the created services.
