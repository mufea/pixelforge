# Deployment

PixelForge AI needs a long-running Next.js server, a long-running worker, PostgreSQL, Redis, and S3-compatible storage. That topology does **not** fit a pure serverless/Vercel deploy without splitting the worker onto another host. The supported path is Docker Compose for local development and the same process split on a VM, PaaS, or Kubernetes cluster for production.

## Local development (Phase 1+)

```bash
docker compose up -d postgres redis minio
cp .env.example .env.local
# fill BETTER_AUTH_SECRET; leave AI keys empty to exercise not-configured paths
pnpm install
pnpm prisma migrate dev
pnpm prisma db seed
pnpm dev          # 127.0.0.1:43127
pnpm worker
```

Compose services (planned):

| Service | Port | Notes |
| --- | --- | --- |
| postgres | 5432 | User/password/db `pixelforge` |
| redis | 6379 | No persistence required for local queues |
| minio | 9000 / 9001 | Bucket `pixelforge-assets` created on start |

Health:

- Web: `GET /api/health` and `GET /api/health/ready`
- Worker: Redis heartbeat key `pixelforge:worker:heartbeat`

## Production topology

```
Load balancer / TLS
        │
        ├─ Next.js (N replicas)
        ├─ Worker (M replicas, concurrency from env)
        ├─ PostgreSQL (managed)
        ├─ Redis (managed, persistence optional but recommended)
        └─ Object storage (S3, R2, GCS S3 API, or MinIO)
```

Environment-specific files: never bake production URLs into the image. Pass `APP_URL`, `DATABASE_URL`, `REDIS_URL`, `S3_*`, and provider keys at runtime.

## Render.com

`render.yaml` is a Blueprint for a Docker **web** service, a Docker **worker**, Render Postgres 16, and Render Key Value (Redis). It does not deploy the app by itself.

Required env group `pixelforge-secrets` (never commit values):

| Variable | Notes |
| --- | --- |
| `APP_URL` | Public HTTPS origin, e.g. `https://pixelforge-web.onrender.com` |
| `BETTER_AUTH_SECRET` | 32+ characters |
| `BETTER_AUTH_URL` | Same as `APP_URL` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Durable object storage. Required in production. |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | Match the bucket provider |
| `FAL_KEY` | Optional. Enables Fal-backed jobs |
| `STABILITY_API_KEY` | Optional. Enables Stability-backed jobs |
| `OPENAI_API_KEY` | Optional. Existing generate/edit path |
| `AI_JOBS_ENABLED` | `true` only after worker + Redis + storage are up |

`DATABASE_URL` and `REDIS_URL` are wired from the Blueprint services. The web container listens on Render's `PORT`. Liveness is `GET /api/health`. Readiness is `GET /api/health/ready` (Postgres, optional Redis ping, storage driver). Secrets are never included.

Migrate **once** before or immediately after the first web deploy, from a Render one-off or shell:

```bash
pnpm prisma migrate deploy
```

Do not use local disk (`.storage`) on Render. Do not claim this Blueprint is live until a human creates the services and a health check returns 200.

A step-by-step go-live list (env split, migrate, health, remaining external config) is in [RENDER_CHECKLIST.md](./RENDER_CHECKLIST.md). Stripe/Midtrans remain a separate slice: [PAYMENTS_PLAN.md](./PAYMENTS_PLAN.md).

## Required managed services

| Concern | Local | Production |
| --- | --- | --- |
| PostgreSQL | Compose | RDS, Cloud SQL, Neon, Supabase, or equivalent |
| Redis | Compose | Render Key Value, ElastiCache, Redis Cloud, Upstash (if latency/queue semantics are acceptable) |
| Object storage | MinIO | S3 / R2 / GCS |
| Email | Console log | Resend or SMTP |
| Secrets | `.env.local` | Platform secret store |

## Build and migrate

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm prisma migrate deploy
```

Images: `Dockerfile` (Next.js standalone) and `Dockerfile.worker`. Both include production dependencies and the generated Prisma client. Run migrations as an init container or a one-shot job **before** starting new app replicas.

## Health, logs, backups

- Process liveness vs readiness as above.
- Structured JSON logs to stdout.
- PostgreSQL: daily automated backups, PITR if the vendor offers it. Test restore in staging.
- Object storage: versioning optional; lifecycle rules for multipart abandons.
- Redis: treat as disposable. Jobs are recoverable from `AIJob` rows in PostgreSQL.
- Never migrate by dropping production data. Never rewrite applied Prisma migrations.

## Recovery

| Failure | Response |
| --- | --- |
| Worker crash mid-job | Recovery sweep: `processing` past `timeoutAt` → retry or fail; reservation still pending until terminal status |
| Redis flush | Re-enqueue `queued` and recoverable `processing` jobs from PostgreSQL |
| Provider outage | Jobs fail retryably then terminal; credits released; admin can disable provider |
| Bad deploy | Roll back container image; database only moves forward with new migrations |

## What will not be claimed until it exists

Dockerfiles, Compose, health routes, and `render.yaml` exist. A live Render deploy has **not** been performed from this slice. Backup/PITR runbooks remain Phase 7.
