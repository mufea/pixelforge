# Phase 3 — Image converter and first AI job

**Result: PASS** (16 October 2026) for the converter, job workflow, mock generate tests, fail-closed behavior when no provider is configured, and a later live OpenAI generate.

Live OpenAI generation **succeeded** after a server-side `OPENAI_API_KEY` was supplied. That result supersedes earlier statements that live generation was blocked. The key is not stored in the repository.

D1–D10 remain in force. Auth and storage were not rewritten.

## Inspection (before coding)

Existing stack: Next.js 16 App Router, Prisma 7, Better Auth, Sharp (upload sanitize only), private storage (local/HMAC here; S3 when configured), Vitest, pnpm.

Phase 2 already owned projects, assets, magic-byte validation, quotas, and signed downloads. Phase 3 reuses those services.

**No blockers for the converter.** Redis was reachable (`PONG`) for the job queue.

**Historical blocker (resolved the same day):** at first inspection, `OPENAI_API_KEY` was empty and `AI_PROVIDER_MODE=live`. Mock generate is forbidden in that mode, so enqueue returned `PROVIDER_NOT_CONFIGURED` (HTTP 503) instead of a fake image. After the key was configured on the server, a live generate job succeeded.

## Converter

- `POST /api/assets/:id/convert` (session + same-origin) converts JPEG/PNG/WebP with Sharp
- Magic bytes and decode are required; truncated files with a valid PNG signature are rejected
- Size, pixel, and edge limits reuse Phase 2 env caps
- Output is a new `DERIVATIVE` asset (`sourceAssetId` points at the original). The original is not deleted
- Storage put that fails never creates a row; a DB write that fails after put deletes the object
- Downloads stay on the Phase 2 ownership-checked signed URL path
- UI: per-asset format select, converting state, original vs output sizes, error alert

## First AI job

- `AIJob` / `AIJobEvent` with queued → processing → succeeded | failed
- `POST /api/jobs` creates a `GENERATE` job only after session, origin, project ownership, and provider resolution
- Worker: BullMQ when `REDIS_URL` is set (outside tests); in-process fallback if Redis is unset in development
- Tests run the processor inline so CI does not need Redis or paid APIs
- Mock provider: `NODE_ENV=test`, or development with `AI_PROVIDER_MODE=mock`. Production rejects mock mode
- OpenAI adapter: `gpt-image-2.5-flare`, timeout via `AbortSignal`, maps 429 / 5xx / missing key
- Retry: CAS claim on `queued`/`failed` (timed-out `processing` only). Existing `sourceJobId` output is reused so a retry does not call the provider again
- UI: generate panel on the project page; hidden and explained when no provider is configured

## Commands run

| Command | Result |
| --- | --- |
| `pnpm exec prisma migrate status` | Applied `20261016012526_phase3_convert_and_jobs` |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | 52 passed (13 files) at first close; 53 passed after the `FAL_API_KEY` env alias |
| `pnpm build` | Pass — includes `/api/assets/[id]/convert`, `/api/jobs`, `/api/jobs/[id]` |

## Tests added

- PNG → JPEG/WebP and JPEG → PNG
- Malformed bytes, truncated PNG, oversized file, oversized edge
- Unsupported output (`image/avif`)
- Unauthenticated convert (401) and cross-tenant convert/download (404)
- Storage put failure: no derivative row; original preserved
- DB failure after put: object deleted
- Mock generate succeeds once; second `processJob` does not duplicate the asset
- Existing `sourceJobId` output is reused (no second provider call)
- Concurrent processors claim once
- Job isolation (404), invalid prompt, validation failure creates no asset
- OpenAI adapter: missing key, 5xx mapping, live mode does not fall back to mock

## Live checks (16 October 2026, `http://127.0.0.1:43127`)

Signed in as `user@pixelforge.local` against PNG `11fc29ba-…` on project `053231a2-…`:

| Check | Result |
| --- | --- |
| `POST /api/assets/:id/convert` PNG → JPEG | HTTP 201, new `DERIVATIVE` `d6b2a000-…`, original PNG still alive |
| Owner download of converted JPEG | HTTP 200 signed `/api/storage/objects` URL; 328 bytes, JPEG magic |
| `outputFormat: image/avif` | HTTP 400 `UNSUPPORTED_OUTPUT_FORMAT` |
| `POST /api/jobs` GENERATE (no provider key yet) | HTTP 503 `PROVIDER_NOT_CONFIGURED` |
| Unauthenticated convert | HTTP 401 |
| Admin convert/download of the user's asset | HTTP 404 |
| Unauthenticated `/app/projects/:id` | HTTP 307 to `/login` |
| Project page (before the key) | "Convert to", "Generation is not live", "OpenAI is not configured" |

### Live OpenAI generate (later the same day)

After `OPENAI_API_KEY` was set in gitignored server env (`AI_PROVIDER_MODE=live`), signed in as the seed user:

| Check | Result |
| --- | --- |
| `POST /api/jobs` GENERATE | HTTP 201 queued, `providerId: openai`, model `gpt-image-2.5-flare` |
| Job lifecycle | queued → processing → **succeeded** in about 10 seconds |
| Output asset | private `GENERATED` PNG, 1024×1024, about 1.4 MB, PNG magic bytes |
| Owner download | HTTP 200 short-lived signed object URL (not a public bucket URL) |
| Admin job and asset access | HTTP 404 |
| Project page | **Generate image** is shown; “Generation is not live” is gone |

## Limitations

- Convert is synchronous in the request (no CONVERT BullMQ job). That keeps conversion working without a worker.
- Batch convert/resize/crop UI is not in this phase; convert is one asset, one output format.
- Credits are not reserved or settled (Phase 5).
- Model registry tables are still documentation-only; generate uses a fixed OpenAI model id or `mock-png`.
- This environment uses local/HMAC private storage, not MinIO.

## Blockers

None that prevent Phase 4 planning. Live OpenAI generate is verified. Fal credentials exist in gitignored env as `FAL_KEY` / `FAL_API_KEY`, but no Fal adapter is implemented (Phase 4). Google image generation is still unconfigured.

Phase 4 feature work must not start until `docs/PHASE_4_PLAN.md` is reviewed and approved.
