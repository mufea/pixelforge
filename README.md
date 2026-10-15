# PixelForge AI

Credit-metered AI image studio: generation, editing, enhancement, conversion, projects, and an admin console.

Phase 2 is live: authentication, owned projects, private image uploads with magic-byte validation, and short-lived download URLs. AI generation, conversion jobs, credits, and payments are not claimed as working yet.

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
| `pnpm worker` | Worker heartbeat (AI processors arrive in Phase 3) |
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
| 3–7 | Not started |
