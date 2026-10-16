# Phase 4.1 — Batch convert, resize, and crop

**Result: PASS** (16 October 2026). Sharp only. No Fal/OpenAI/billing changes.

Single-file `POST /api/assets/:id/convert` remains synchronous HTTP. Optional `width`, `height`, and `crop` were added. Batch is `POST /api/projects/:id/convert` with at most 20 unique owned asset IDs. The entire batch is validated before any derivative is written. Processing failure rolls back derivatives created in that request. Originals are not deleted.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | 60 passed (14 files) |
| `pnpm build` | Pass — includes `/api/projects/[id]/convert` |

No new Prisma migration.

## Live checks

Seed user, Spring campaign project:

| Check | Result |
| --- | --- |
| Batch two originals → WebP 24×16 | HTTP 201, two `DERIVATIVE` assets |
| Single crop → JPEG 24×16 | HTTP 201 |
| Originals | still PNG, not deleted |
| 21-asset batch | HTTP 400 `BATCH_TOO_LARGE` |
| Unauthenticated batch | HTTP 401 |
| Admin batch on the user’s project | HTTP 404 |
| Project page | “Batch convert, resize, and crop” |

## Limitations

- Batch is still synchronous HTTP, not a CONVERT BullMQ job.
- Crop is a numeric box (no visual marquee).
- Geometric resize can enlarge up to existing pixel/edge caps; it is not an AI upscaler (slice 4.3).
- Slices 4.2–4.6 are not started.
