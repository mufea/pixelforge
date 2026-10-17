# Phase 4 plan — AI image studio

**Status:** Slice **4.1 PASS**. Slice **4.5 PASS**. Slice **4.2 PASS** (background removal jobs; mock tests, no live Fal). Slice **4.3 PASS** (upscale jobs; mock tests, no live Fal). Slice **4.4 PASS** (edit / object removal; mock tests, no live OpenAI/Fal). Slice 4.6 is not started. Do not implement the next slice until approved. See [PHASE_4_1.md](./PHASE_4_1.md), [PHASE_4_5.md](./PHASE_4_5.md), [PHASE_4_2.md](./PHASE_4_2.md), [PHASE_4_3.md](./PHASE_4_3.md), and [PHASE_4_4.md](./PHASE_4_4.md).

Phase 3 is **PASS**. This plan extends the existing Next.js app, Prisma schema, private storage, and BullMQ worker. It does not restart Phase 3 or replace working convert/generate paths.

Baseline checks recorded while writing this plan (16 October 2026): `pnpm lint` pass, `pnpm typecheck` pass, `pnpm test` 53 passed (13 files), `pnpm build` pass. Migration `20261016012526_phase3_convert_and_jobs` remains applied.

## 1. Current architecture and reusable Phase 3 components

Single repo: Next.js 16 App Router + `worker/` sharing `lib/`. Prisma 7 + PostgreSQL. Better Auth sessions. Private object storage (`lib/storage`: local/HMAC in this environment, S3 when configured). BullMQ + Redis with queue name `jobs` and prefix `QUEUE_PREFIX` (colon-free; BullMQ 6 rejects `:` in names).

**Reuse as-is**

| Piece | Role in Phase 4 |
| --- | --- |
| `getOwnedProject` / `getOwnedAsset` / `getOwnedJob` | Tenant isolation; cross-user IDs stay 404 |
| `assertSameOrigin` + `requireUserFromRequest` | Mutations |
| `convertImageBytes` + `persistDerivedAsset` | Sharp output as `DERIVATIVE` / `GENERATED` with `sourceAssetId` / `sourceJobId` |
| `validateAndSanitizeImage`, MIME magic, `MAX_UPLOAD_BYTES`, `MAX_IMAGE_PIXELS`, `MAX_IMAGE_EDGE_PX`, `STORAGE_QUOTA_BYTES` | Input bounds |
| `createDownloadUrl` / `/api/storage/objects` | Authorized short-lived GET; no public bucket URLs |
| `AIJob` / `AIJobEvent`, `enqueueJob`, `processJob` CAS claim, `reuseExistingOutput` | Job lifecycle and retry safety |
| `lib/ai/types.ts` `ProviderResult`, mock generate, OpenAI generate | Pattern for new adapters |
| `isOpenAIConfigured`, `isFalConfigured`, `isMockAiAllowed` | Fail closed when keys missing; mock forbidden in production |
| Asset kinds `ORIGINAL` / `DERIVATIVE` / `GENERATED` | New outputs; originals stay unless the user deletes them |

**Hardcoded today (must not stay the only dispatch path)**

- `createGenerateJobSchema` accepts only `operation: "GENERATE"`
- `processJob` rejects any other operation
- Generate provider is OpenAI or mock, not a registry
- Convert is synchronous HTTP (`POST /api/assets/:id/convert`), not a CONVERT job
- `Provider`, `AIModel`, `OperationPrice`, credit ledger tables are documented in `docs/DATABASE.md` but **not** in `prisma/schema.prisma`

Existing API surface to keep: `/api/assets/[id]/convert`, `/api/jobs`, `/api/jobs/[id]`, upload intents, download, storage objects, health, Better Auth.

## 2. Feature scope and exclusions

### In scope (this phase, after approval)

Studio operations on **owned** images, private result storage, job status UI, provider adapters behind one interface, capability refusal instead of silent fallback.

### Explicit exclusions

- Public REST API keys / `/api/v1` (D8: after studio jobs are stable)
- Rewriting Better Auth, storage drivers, or Phase 2 upload completion
- Charging “whatever the provider billed” (D4: settle configured credits on success only — when credits exist)
- Enabling Google live calls until `GOOGLE_AI_API_KEY` is supplied
- Using mock adapters in production
- Product studio, marketing overlay studio, variations gallery, and admin model-picker UI unless a later approved slice adds them (they were in the original Phase 4 narrative but are not in the six slices below)
- Payments, webhooks, Midtrans, Stripe (original Phase 5; see slice 4.6 recommendation)

## 3. Proposed slices, dependencies, and order

The six-slice roadmap in the request is workable in content but **not in that order**. Credits before adapters would block every tool on an unimplemented ledger. Fal/OpenAI ops before a shared adapter layer would copy the current hardcoded generate path.

**Recommended order**

| Order | Slice | Depends on | Why this order |
| --- | --- | --- | --- |
| 1 | **4.1** Batch convert / resize / crop | Phase 3 Sharp convert | No paid provider. Completes the Phase 3 converter gap. Same validation and `persistDerivedAsset`. |
| 2 | **4.5** Provider adapter architecture | 4.1 optional | Registry + operation interfaces **before** more vendor calls. Stops a second hardcoded adapter. |
| 3 | **4.2** Background removal | 4.5, Fal key present | Simplest Fal-shaped op: one input asset, transparent PNG, no mask UI. |
| 4 | **4.3** Upscale / enhancement | 4.5, Fal (or labeled Sharp geometric resize) | Same job+asset pattern as 4.2; output dimension/quota checks are stricter. |
| 5 | **4.4** AI edit + object removal | 4.5, OpenAI edit and/or Fal mask | Needs mask assets, capability flags, and more input validation. |
| 6 | **4.6** Credits / usage / payments | Working billable ops | Original plan Phase 5. Do not put money in front of tools that are not finished. |

Do **not** assume one provider for all tools:

| Operation | Primary | Fallback | Local |
| --- | --- | --- | --- |
| GENERATE (exists) | OpenAI `gpt-image-2.5-flare` | none until Google key exists | mock in tests |
| CONVERT / RESIZE / CROP | — | — | Sharp |
| REMOVE_BACKGROUND | Fal (`fal-ai/bria/background/remove` or successor confirmed at implement time) | none | none |
| UPSCALE | Fal `fal-ai/flux-vision-upscaler` | none | none (live mode fails closed; mock nearest-neighbor is tests/dev only) |
| EDIT / inpaint | OpenAI `gpt-image-2.5-flare` `/v1/images/edits` | none | none (mock in tests) |
| REMOVE_OBJECT | Fal `fal-ai/object-removal/mask` | none | none (mock in tests) |

If a selected model does not list the operation, return `MODEL_CAPABILITY_UNSUPPORTED`. Do not silently switch vendors.

## 4. API, database, and job lifecycle

### HTTP (all session + same-origin on mutations)

Keep convert for single-file format change. Add job-backed ops rather than unbounded request-body image bytes.

| Method | Path | Purpose |
| --- | --- | --- |
| existing | `POST /api/assets/:id/convert` | Single convert (keep). Optional: enqueue CONVERT when output would exceed a size threshold |
| new | `POST /api/jobs` | Extend body: `operation`, `projectId`, `inputAssetIds[]`, params (format, width/height, crop box, prompt, maskAssetId). Zod per operation |
| existing | `GET /api/jobs/:id`, `GET /api/jobs?projectId=` | Status; ownership-scoped |

Client never sends userId, prices, storage keys, or provider API keys.

### `inputJson` (Redis/job row: identifiers only)

Example: `{ operation, inputAssetIds, outputFormat, width, height, crop, prompt, maskAssetId, modelId }`. Workers load bytes from private storage after `assertOwnedStorageKey`.

### Database (forward-only Prisma migrations; no rewrite of Phase 3 tables)

**4.1:** probably none if CONVERT jobs reuse `AIJob.operation = "CONVERT"` (string already). Optional: batch parent id on `AIJob` or `idempotencyKey` per (user, sourceAsset, params).

**4.5:** add documented-but-missing models: `Provider`, `AIModel`, `OperationPrice` (credits unused until 4.6). Seed OpenAI generate + Sharp convert + Fal rows **disabled** until keys/capabilities are confirmed.

**4.2–4.4:** no new core tables required if `Asset.kind` already includes `MASK` / `DERIVATIVE` / `GENERATED`. Mask uploads reuse Phase 2 intent + magic-byte path (PNG).

**4.6 (if approved here instead of Phase 5):** `CreditAccount`, `CreditReservation`, `CreditLedgerEntry`, `Payment`, `WebhookEvent` as in `docs/DATABASE.md` / `docs/BILLING_AND_CREDITS.md`.

Do not mutate applied migration `20261016012526_phase3_convert_and_jobs`. Do not backfill or delete user assets.

### Job lifecycle (unchanged states)

`queued → processing → succeeded | failed` (cancel later if needed).

Processor changes: dispatch on `operation`; CAS claim and `reuseExistingOutput` stay. Validation errors are not retried. Provider 429/5xx/timeout retryable with the existing attempt cap. Worker never writes a second output for the same job id.

Large Sharp work (batch, big resize) **should** use CONVERT jobs so the HTTP request does not hold a 25 MP decode. Single small convert may remain sync.

## 5. Security, isolation, storage, validation, limits

Carry forward Phase 2–3 rules. Phase 4 must not weaken them.

- Session required. Cross-tenant project/asset/job → **404**
- Admin does not bypass ownership on user studio APIs unless a later admin-ops slice says so (today convert/generate are owner-only)
- Magic bytes + Sharp decode on every input, including provider outputs before persist
- Caps: `MAX_UPLOAD_BYTES`, `MAX_IMAGE_PIXELS`, `MAX_IMAGE_EDGE_PX`; upscale must reject results that would exceed caps or quota
- Batch convert: hard max N sources per request (propose **20**) and total output bytes vs quota **before** enqueue
- Crop boxes are integers in image space; reject empty, inverted, or out-of-bounds crops
- Provider result **URLs are fetched only from an adapter allowlist** (Fal CDN / OpenAI), then copied into our bucket. Never persist vendor URLs as the only copy. Never fetch user-supplied URLs
- Keys only in server env (`FAL_KEY` / `FAL_API_KEY` alias, `OPENAI_API_KEY`). No `NEXT_PUBLIC_` secrets
- `AI_JOBS_ENABLED` remains a kill switch
- Concurrency: reuse `USER_CONCURRENCY_LIMIT` when wired; until then keep worker `concurrency: 2`

## 6. Provider strategy

| Provider | Env today | Implemented adapter | Proposed |
| --- | --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` set in gitignored env; live generate verified | `lib/ai/providers/openai-generate.ts` (`gpt-image-2.5-flare`) | Images **edits** for 4.4 when mask/reference supported; do not use `dall-e-2` / `dall-e-3` / shutdown `gpt-image-1` |
| Fal | `FAL_KEY` / `FAL_API_KEY` in gitignored env | `fal-ai/bria/background/remove` (4.2), `fal-ai/flux-vision-upscaler` (4.3); HTTP stubbed in tests, no live spend | Remaining catalog rows stay stubs (`fal-ai/object-removal/mask`, generate). Confirm new model IDs against fal.ai at implement time |
| Google | `GOOGLE_AI_API_KEY` empty | **None** | Adapter stub + `PROVIDER_NOT_CONFIGURED`. No live Google until a key is authorized |
| Mock | test, or `AI_PROVIDER_MODE=mock` in development | `mockGenerate`, `mockRemoveBackground`, `mockUpscale` | Per-operation mocks (transparent PNG, upscaled PNG, edited PNG) for CI |
| Sharp | always | convert | resize/crop/compress only. 4.3 does **not** use Sharp as a live upscale fallback |

Live mode never returns a fabricated success image. Missing key → `PROVIDER_NOT_CONFIGURED` and UI copy, same as generate before the OpenAI key existed.

## 7. Testing strategy

**Automated (CI, mock / Sharp only — no paid calls)**

- 4.1: format matrix, crop bounds, resize caps, batch isolation, original preserved, quota, storage cleanup
- 4.5: capability matrix rejects unsupported op/size/mask; mock vs live mode; production rejects mock
- 4.2–4.4: mock adapters; ownership 401/404; malformed/oversized input; retry does not duplicate output; vendor URL not stored
- Fal/OpenAI/Google HTTP mapping unit tests with recorded JSON fixtures (429, 5xx, timeout), not live keys
- Regression: existing 53 tests must stay green

**Live (manual, optional, documented in the slice report)**

- 4.1: no vendor
- 4.2: Fal background remove on an owned PNG if Fal key present; skip and record blocker if Fal rejects the model or account
- 4.3: Fal upscale skipped (no approval to spend Fal credits); mock + stubbed HTTP only
- 4.4: OpenAI edit and Fal object-remove skipped (no approval to spend credits); mock + stubbed HTTP only
- Never commit credentials. Never attach private generated bytes to git

## 8. Acceptance criteria and evidence per slice

Each slice is **PASS** only with: `pnpm lint`, `typecheck`, `test`, `build`, migration status if schema changed, and the slice-specific checks below. Do not mark PASS from UI screenshots alone.

**4.1**

- Resize/crop/convert produce a new `DERIVATIVE`; source `deletedAt` is null
- Batch: all-or-nothing enqueue after validation; one owned failure does not leak another user’s asset
- Output dimensions and bytes reported
- Evidence: tests + one live sync or job convert/resize on the seed project

**4.5**

- Worker dispatches by `operation` + registry capabilities
- UI/API hide or 400 unsupported options
- Disabling a provider/model in DB (once tables exist) blocks enqueue without a frontend change
- Evidence: unit tests for registry; generate still works with OpenAI

**4.2**

- Transparent PNG preview; original preserved
- Fal unconfigured → 503 `PROVIDER_NOT_CONFIGURED`, not a fake cutout
- Evidence: mock tests always; live Fal only if the call succeeds (record HTTP/model, not keys)

**4.3** — **PASS** (16 October 2026). See [PHASE_4_3.md](./PHASE_4_3.md).

- Result within pixel/edge/quota caps; unsupported factors rejected
- Live mode has **no** Sharp geometric fallback; missing Fal → `PROVIDER_NOT_CONFIGURED`
- Evidence: mock + limit + auth + retry tests; live Fal not run

**4.4** — **PASS** (16 October 2026). See [PHASE_4_4.md](./PHASE_4_4.md).

- Mask required for `REMOVE_OBJECT`; missing mask → `MASK_REQUIRED`, not a provider call
- Object removal and edit are separate operations
- Evidence: mock + isolation + retry tests; live OpenAI/Fal not run

**4.6** (if not deferred)

- Enqueue without credits → `INSUFFICIENT_CREDITS`
- Concurrent spend cannot overdraw
- Duplicate webhook does not double-grant
- Redirect-only payment grants nothing
- Evidence: ledger tests listed in `docs/BILLING_AND_CREDITS.md`

## 9. Migration and rollback

- New Prisma migrations only; never edit applied SQL
- Registry seed is idempotent (`upsert` on provider/model slug)
- Rollback: disable `AI_JOBS_ENABLED` or disable a `Provider`/`AIModel` row; do not delete `AIJob` or `Asset` history
- CONVERT job introduction must leave `POST /api/assets/:id/convert` working
- 4.6 ledger migration on existing users: create `CreditAccount` with **zero** available unless a documented grant is approved; do not invent balances
- Redis queue prefix stays `QUEUE_PREFIX`; do not reintroduce `:` in queue names

## 10. Risks, unresolved decisions, prerequisites

### Risks

| Risk | Mitigation |
| --- | --- |
| Fal model IDs drift | Confirm at implement time; store in registry not React |
| Cost runaway | Keep `AI_JOBS_ENABLED`; add credits before widening live Fal |
| Duplicate vendor billing on retry | Keep `sourceJobId` reuse; copy bytes before succeeded |
| Fal result URL expiry | Download into our storage before succeeding the job |
| Sync Sharp OOM on batch | Job + pixel caps; max batch size |
| Scope creep (product/marketing studio) | Excluded until approved |

### Decisions that need approval before coding

1. **Slice order** — accept 4.1 → 4.5 → 4.2 → 4.3 → 4.4 → (4.6 deferred)?
2. **Defer 4.6 to Phase 5** (recommended; matches `docs/IMPLEMENTATION_PLAN.md` and D4/D6/D10).
3. **Single-file convert:** keep sync HTTP vs always enqueue CONVERT.
4. **Batch max N** (proposed 20) and whether partial batch success is allowed (proposed: reject the whole request on any invalid id).
5. **Live Fal smoke** in 4.2: authorized to spend Fal credits on background removal?
6. **Google:** wait for a key, or ship adapter-not-configured only.
7. **Geometric Sharp upscale:** **rejected for 4.3.** Live mode fails closed with `PROVIDER_NOT_CONFIGURED`. Mock nearest-neighbor exists for tests only.
8. **Product / marketing studios:** stay excluded from Phase 4.1–4.5?

### Prerequisites (already true unless noted)

- Phase 3 convert + generate PASS
- Redis + worker for async jobs
- OpenAI generate live-verified
- Fal credentials in gitignored env; **adapter not written**
- Google key **absent**
- Credit tables **absent**

## Recommended first implementation slice

**Slice 4.1 — batch conversion, resize, and crop (Sharp only).**

It does not depend on Fal/Google, does not touch billing, reuses `convertImageBytes` / `persistDerivedAsset` / ownership checks, and finishes the converter surface Phase 3 left as a limitation. After 4.1, 4.5 should land before any new paid vendor operation.

Stop here. No Phase 4 feature code until this plan is approved.
