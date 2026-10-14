# PixelForge AI

Production-oriented AI image processing SaaS: generation, editing, enhancement, background and object removal, product photography, marketing creatives, conversion, projects, credits, subscriptions, and an admin console.

This repository is in **Phase 0**. Architecture, database design, provider strategy, billing invariants, security, and a phased implementation plan are documented. Application code, Docker services, and the Prisma schema are intentionally not generated until the decisions in `docs/IMPLEMENTATION_PLAN.md` are approved.

## Status

| Item | State |
| --- | --- |
| Phase 0 — Repository audit and architecture | Complete, awaiting approval |
| Phase 1 — Foundation | Not started |
| Working web application | Not present |
| Database / worker / storage | Not present |

## Documentation

| Document | Contents |
| --- | --- |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phase 0 audit, decisions needing approval, acceptance criteria |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System boundaries, directory layout, request and job flows |
| [docs/DATABASE.md](docs/DATABASE.md) | Prisma model outline, indexes, ownership rules |
| [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md) | Adapter interfaces, verified model IDs, capability matrix |
| [docs/BILLING_AND_CREDITS.md](docs/BILLING_AND_CREDITS.md) | Ledger invariants, plans, webhooks |
| [docs/SECURITY.md](docs/SECURITY.md) | AuthZ, uploads, tenancy, headers, logging |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker, managed services, health, backups |

Environment variables are listed in `.env.example`. None of those files contain secrets.

## Intended local workflow (Phase 1+)

These commands will be valid after Phase 1. They are specified now so later phases do not invent a second interface.

```bash
pnpm install
cp .env.example .env.local
docker compose up -d postgres redis minio
pnpm prisma migrate dev
pnpm prisma db seed
pnpm dev                 # Next.js on 127.0.0.1:43127
pnpm worker              # BullMQ worker
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Non-goals for Phase 0

- Scaffolding Next.js, Prisma, or Docker
- Calling AI providers
- Implementing payments
- Claiming any studio feature is functional
