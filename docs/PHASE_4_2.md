# Phase 4.2 — AI background removal

**Result: PASS** (16 October 2026). Provider-backed `REMOVE_BACKGROUND` jobs on owned JPEG/PNG/WebP assets. Output is a private transparent PNG `DERIVATIVE`. The source asset is not deleted. No Prisma migration. No live Fal/OpenAI/Google calls in this slice.

Builds on Phase 4.5. Convert (4.1) and generate remain unchanged.

## Why no database migration

`AIJob.operation` is already a string. `Asset.kind` already includes `DERIVATIVE`. `sourceAssetId` / `sourceJobId` already exist. Provider/AIModel tables stay deferred.

## API contract

`POST /api/jobs` (session + same-origin), in addition to `GENERATE`:

```json
{
  "operation": "REMOVE_BACKGROUND",
  "projectId": "<uuid>",
  "assetId": "<uuid>"
}
```

Response `201` is the existing `publicJob` shape (`id`, `operation`, `status`, `providerId`, `modelId`, `outputAssetIds`, `errorCode`, `errorMessage`, `createdAt`, `finishedAt`). Poll `GET /api/jobs/:id` (owner-only).

Enqueue checks: project ownership, asset ownership and project match (cross-tenant and cross-project → 404), JPEG/PNG/WebP only, size vs `MAX_UPLOAD_BYTES`, storage quota, provider resolution.

Worker: load bytes from private storage after `assertOwnedStorageKey`, run the Phase 4.5 factory (`mock-bg-remove` or Fal `fal-ai/bria/background/remove`), sanitize the PNG, re-check quota, persist `DERIVATIVE` with `sourceAssetId` + `sourceJobId`. Existing output for the same job is reused. Storage put / DB persist failures delete the incomplete object and do not keep a derivative row.

## Provider routing

- Test / `AI_PROVIDER_MODE=mock`: mock adapter (deterministic transparent border). Never bills a vendor.
- Live with `FAL_KEY`: Fal adapter via the same factory. Result URLs must be `https` on `fal.media` / `*.fal.media`. Credentials stay server-side.
- Live without Fal: `PROVIDER_NOT_CONFIGURED` (503), not a fake cutout.

This slice did **not** execute live Fal. Adapter HTTP is covered with stubbed `fetch` (429, 5xx, timeout, untrusted URL).

## Commands run

| Command | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | 95 passed (17 files) |
| `pnpm build` | Pass — includes `/api/jobs`, convert routes unchanged |

No new Prisma migration.

## Tests added

- Mock job → private PNG with alpha; source checksum unchanged
- Owner download of the derivative; stranger job/download 404; unauthenticated enqueue 401
- `image/gif` → `VALIDATION_INVALID_MIME`; quota full → `QUOTA_EXCEEDED`; live without Fal → `PROVIDER_NOT_CONFIGURED`
- Storage put failure → job failed, no derivative, original kept
- Retry reuses `sourceJobId` output
- Mock timeout; Fal 429/5xx/timeout/untrusted URL without network I/O

## Security and quota

- Session + same-origin on enqueue. Owner-only asset/job/download.
- No API keys in client bundles or job JSON.
- Provider result hosts allowlisted; user-supplied URLs are not fetched.
- Quota checked at enqueue (source size) and again before persist (output bytes). `persistDerivedAsset` increments `storageUsedBytes` and deletes the object if the DB write fails.

## Limitations / deferred

- Live Fal smoke (not run; no approval to spend Fal credits)
- AI upscale (4.3 — implemented separately; see [PHASE_4_3.md](./PHASE_4_3.md)), edit / object removal (4.4), credits (4.6)
- CONVERT as a BullMQ job
- `Provider` / `AIModel` tables
