# PixelForge AI

Credit-metered AI image studio: generation, editing, enhancement, conversion, projects, and an admin console.

Phase 1 is live: authentication, role-based workspace and admin shells, public marketing pages, PostgreSQL persistence, health checks, and a seedable plan catalog. Uploads, workers that call AI providers, and payments are not claimed as working yet.

## Requirements

- Node.js 22 and pnpm 10
- PostgreSQL 16 (Docker Compose or a local server)
- Redis 7 and MinIO are defined in Compose for later phases

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
| 2–7 | Not started |
