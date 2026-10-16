# PixelForge AI

Credit-metered AI image studio: generation, editing, enhancement, conversion, projects, and an admin console.

Phase 3 is live: authentication, owned projects, private uploads, PNG/JPEG/WebP conversion (original preserved), and asynchronous generate jobs. Live OpenAI generate has been verified in this environment. If `OPENAI_API_KEY` is unset, the API returns `PROVIDER_NOT_CONFIGURED` rather than a fake image. Credits and payments are not implemented.

## Requirements

- Node.js 22 and pnpm 10
- PostgreSQL 16 (Docker Compose or a local server)
- Redis 7 (jobs, Phase 3) and MinIO/S3 (uploads; local private storage is used if S3 is unset in development)

## Setup

```bash
pnpm install
cp .env.example .env.local
# set DATABASE_URL and BETTER_AUTH_SECRET (32+ characters)
docker compose up -d postgres redis minio
# if Docker is unavailable, run a local PostgreSQL 16 instance instead
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The app listens on `http://127.0.0.1:43127`.

Development seed accounts (local only):

- `admin@pixelforge.local` / `DevAdmin!23456`
- `user@pixelforge.local` / `DevUser!23456`

Override with `SEED_ADMIN_PASSWORD` and `SEED_USER_PASSWORD`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Next.js on 127.0.0.1:43127 |
| `pnpm worker` | BullMQ worker for generate jobs (requires `REDIS_URL`) |
| `pnpm db:migrate` | Create/apply Prisma migrations |
| `pnpm db:seed` | Plans, settings, admin and user accounts |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit and integration tests |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |

## Documentation

See `docs/` for architecture, database, providers, billing, security, deployment, and the implementation plan.

## Phase status

| Phase | Status |
| --- | --- |
| 0 Architecture | PASS |
| 1 Foundation | PASS |
| Post-test audit | Complete — see docs/POST_TEST_AUDIT.md |
| 2 Projects and assets | PASS |
| 3 Converter and first AI job | PASS (live OpenAI generate verified) |
| 4 AI image studio | Planning — see docs/PHASE_4_PLAN.md |
| 5–7 | Not started |
