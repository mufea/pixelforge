# Production environment-variable matrix

Source of values is what an operator must supply. Preflight (`pnpm preflight`) checks presence and format only. It never prints secret values. `pnpm preflight --connect` additionally runs `SELECT 1` on PostgreSQL and `PING` on Redis. Neither command applies migrations, writes objects, or calls Fal/Stability/Stripe.

`render.yaml` lists Blueprint names. That file is not evidence that the services exist.

| Variable | Required | Service | Secret | Source of value | Validation |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | required | both | no | Render service env (`production`) | `development` \| `test` \| `production`; mock AI forbidden when `production` |
| `APP_URL` | required | both | no | Public HTTPS origin | URL; https in production (localhost allowed only for local checks) |
| `BETTER_AUTH_URL` | required in production | web | no | Same public origin as `APP_URL` | URL; must match `APP_URL` in production |
| `BETTER_AUTH_SECRET` | required | both | yes | Secret group / password manager | Length ≥ 32; never logged |
| `DATABASE_URL` | required | both | yes | Render Postgres `connectionString` or other managed Postgres | `postgres://` or `postgresql://`; `--connect` runs `SELECT 1` |
| `REDIS_URL` | required in production (worker) | both | yes | Render Key Value `connectionString` or other Redis | `redis://` or `rediss://`; `--connect` runs `PING` |
| `QUEUE_PREFIX` | optional | both | no | Default `pixelforge` | Non-empty; no `:` (BullMQ 6) |
| `S3_ENDPOINT` | required in production | both | no | R2 / AWS S3 / hosted MinIO | URL; all four S3 fields required together in production |
| `S3_BUCKET` | required in production | both | no | Bucket name | Present with the other S3 fields |
| `S3_ACCESS_KEY_ID` | required in production | both | yes | Storage IAM / API token | Present; never logged |
| `S3_SECRET_ACCESS_KEY` | required in production | both | yes | Storage IAM / API token | Present; never logged |
| `S3_REGION` | optional | both | no | Default `us-east-1` | Non-empty if overridden |
| `S3_FORCE_PATH_STYLE` | optional | both | no | `true` for MinIO/path-style | `true` \| `false` |
| `FAL_KEY` / `FAL_API_KEY` | optional | both | yes | Fal dashboard | Presence only; alias accepted; live jobs still need billing enabled on the Fal account |
| `STABILITY_API_KEY` | optional | both | yes | Stability dashboard | Presence only |
| `OPENAI_API_KEY` | optional | both | yes | OpenAI dashboard | Presence only |
| `GOOGLE_AI_API_KEY` | optional | both | yes | Google AI Studio | Presence only |
| `AI_PROVIDER_MODE` | optional | both | no | Default `live` | `live` \| `mock`; `mock` rejected in production |
| `AI_JOBS_ENABLED` | optional | both | no | Default on | `true` \| `false`; set `false` until worker + Redis + S3 are verified |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | web | secret for client secret | Google Cloud OAuth | Both required together to show Google sign-in |
| `EMAIL_FROM` | optional | web | no | Default local from-address | Non-empty if overridden |
| `RESEND_API_KEY` / `SMTP_*` | optional | web | yes | Email vendor | Presence only; unset logs verify links in development |
| `STRIPE_*` / `MIDTRANS_*` | optional | web | yes except publishable/client keys | Not required for startup | Presence only; payments are a later slice |
| `PORT` | optional | web | no | Render injects `PORT` | Positive integer; web Dockerfile honors `${PORT:-43127}` |
| `ZIP_EXPORT_MAX_FILES` / `ZIP_EXPORT_MAX_BYTES` | optional | web | no | Defaults 50 / 100 MiB | Positive integers |
| `JOB_DEFAULT_TIMEOUT_MS` / provider `*_TIMEOUT_MS` | optional | worker | no | Defaults 120–180s | Positive integers |

Web and worker must share `DATABASE_URL`, `REDIS_URL`, `QUEUE_PREFIX`, `S3_*`, `AI_PROVIDER_MODE`, `AI_JOBS_ENABLED`, and the same provider keys. A web replica that can enqueue against a worker that cannot read the same bucket or queue will strand jobs and reserved credits.

Migrations are applied with `pnpm prisma migrate deploy` (or `pnpm db:deploy`) as an explicit one-off. Preflight only confirms the four migration directories exist on disk.
