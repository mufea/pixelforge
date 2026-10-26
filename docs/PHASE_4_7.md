# Phase 4.7 — Fal official client, Stability AI, Render Blueprint

**Result:** `pnpm lint` pass. `pnpm typecheck` pass. `pnpm test` **145 passed** (23 files). `pnpm build` pass (includes `/api/health/ready`). `git diff --check` clean. Live Fal, live Stability, and a live Render deploy were **not** run. Mock and stubbed-HTTP tests exercise request construction, error mapping, SSRF allowlists, and provider auto-select. Do not treat that as a live provider PASS or a production deploy PASS.

## Slice A — repository audit (this checkout)

Branch started from `feat/phase-4-6-credit-billing` at `feb5cba`. Working tree was clean. `main` may be a merge-ahead of Cloud Agent notes only.

### Existing architecture

Single Next.js 16 App Router app + `worker/` sharing `lib/`. Prisma 7 + PostgreSQL. Better Auth. Private storage (`local` in development, S3 when configured, **S3 required in production**). BullMQ + Redis. In-code provider registry (`lib/ai/registry.ts`) and factory (`lib/ai/factory.ts`).

Job lifecycle: `queued → processing → succeeded | failed`. `POST /api/jobs` creates `GENERATE`, `REMOVE_BACKGROUND`, `UPSCALE`, `EDIT`, `REMOVE_OBJECT`. Convert/resize/crop stay Sharp and free.

### Already working

| Area | Status |
| --- | --- |
| Auth, projects, owned uploads | Shipped (Phases 1–2) |
| Sharp convert / resize / crop / batch | Shipped (4.1) |
| OpenAI generate + edit | Shipped; live generate verified earlier |
| Fal background remove / upscale / object remove | Shipped via raw `fal.run` HTTP; tests mocked fetch |
| Job ownership isolation | Shipped |
| Health `/api/health` | Shipped |

### Missing or incomplete (pre-slice)

- Official `@fal-ai/client` and Fal generate
- Stability AI (no provider id, env, adapter, or tests)
- Image-to-image / background replace as first-class job operations
- Credit ledger **on this branch** (draft PR #1 on `cursor/phase-46-credits-billing-e526` is not merged)
- Stripe / Midtrans, ZIP export, padding, dedicated studio routes
- `render.yaml` and production `PORT` binding

### Security / reliability risks carried forward

- Production must not use local disk for assets
- Fal result URLs expire; bytes must be copied in-bucket (already true)
- No silent cross-vendor fallback (must stay true)
- Credits are not enforced on this branch; live jobs can spend vendor quota with no user ledger
- Redis remains required for enqueue; jobs recover from PostgreSQL if Redis is flushed

## Slice B — what this change does

- Add `@fal-ai/client` and route all Fal operations through `subscribe` (queue)
- Implement Fal `GENERATE` on `fal-ai/flux/schnell` (documented in the official client)
- Keep `fal-ai/flux-2-pro` disabled
- Add Stability REST v2beta adapters for generate, inpaint, erase, remove-background, and 4× upscale
- Auto-select the first configured provider per operation; never retry a failed vendor on another vendor
- Add `render.yaml`, honor `PORT` in the web Docker image, document Render env and migrate

## Explicitly not in this slice

- New job operations (`IMAGE_TO_IMAGE`, background replace)
- Recreating the credit ledger (use PR #1)
- Fal EDIT
- Live provider smoke tests
- A claimed Render production deploy
- UI overhaul / ZIP / padding

## Files expected to change

`lib/ai/types.ts`, `lib/ai/registry.ts`, `lib/ai/factory.ts`, `lib/ai/config.ts`, `lib/ai/errors.ts`, `lib/env.ts`, `lib/ai/providers/fal.ts`, `lib/ai/providers/fal-client.ts`, `lib/ai/providers/stability.ts`, `app/api/health/ready/route.ts`, `next.config.ts`, `package.json`, `Dockerfile`, `render.yaml`, `.env.example`, provider docs, and unit tests.
