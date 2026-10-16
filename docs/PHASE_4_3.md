# Phase 4.3 — AI image upscale

**Result: PASS** (16 October 2026). Provider-backed `UPSCALE` jobs on owned JPEG/PNG/WebP assets. Output is a private `DERIVATIVE`. The source asset is not deleted or modified. No Prisma migration. No live Fal/OpenAI/Google calls in this slice.

Builds on Phase 4.5 (factory/registry) and Phase 4.2 (async jobs on a source asset). Convert (4.1) and generate remain unchanged.

## Why no database migration

`AIJob.operation` is already a string. `Asset.kind` already includes `DERIVATIVE`. `sourceAssetId` / `sourceJobId` already exist. Provider/AIModel tables stay deferred.

## API contract

`POST /api/jobs` (session + same-origin), in addition to `GENERATE` and `REMOVE_BACKGROUND`:

```json
{
  "operation": "UPSCALE",
  "projectId": "<uuid>",
  "assetId": "<uuid>",
  "scaleFactor": 2
}
```

`scaleFactor` must be the JSON number `2`, `3`, or `4`. Other values, including `1`, `5`, and non-integers, return `UNSUPPORTED_UPSCALE_FACTOR` (400).

Response `201` is the existing `publicJob` shape (`id`, `operation`, `status`, `providerId`, `modelId`, `outputAssetIds`, `errorCode`, `errorMessage`, `createdAt`, `finishedAt`). Poll `GET /api/jobs/:id` (owner-only). Storage keys, `FAL_KEY`, and other secrets are never included.

Enqueue checks: project ownership, asset ownership and project match (cross-tenant and cross-project → 404), JPEG/PNG/WebP only, size vs `MAX_UPLOAD_BYTES`, planned output vs `MAX_IMAGE_EDGE_PX` / `MAX_IMAGE_PIXELS`, storage quota (`source.byteSize * scaleFactor²`), provider resolution.

Worker: load bytes from private storage after `assertOwnedStorageKey`, run the Phase 4.5 factory (`mock-upscale` or Fal `fal-ai/flux-vision-upscaler`), reject a result that is smaller than the source or that exceeds pixel/edge/upload caps, sanitize, re-check quota on actual bytes, persist `DERIVATIVE` with `sourceAssetId` + `sourceJobId` and filename `{base}-{n}x.{ext}`. Existing output for the same job is reused. Storage put / DB persist failures delete the incomplete object and do not keep a derivative row.

## Provider routing

- Test / `AI_PROVIDER_MODE=mock`: mock adapter (deterministic nearest-neighbor PNG at exact `scaleFactor`). Never bills a vendor. This is **not** a live geometric-upscale product path.
- Live with `FAL_KEY`: Fal adapter `fal-ai/flux-vision-upscaler` via the same factory. Request is `POST https://fal.run/fal-ai/flux-vision-upscaler` with `Authorization: Key $FAL_KEY`, body `{ image_url: "<data URI>", upscale_factor: 2|3|4 }`. Result URLs must be `https` on `fal.media` / `*.fal.media`. Credentials stay server-side.
- Live without Fal: `PROVIDER_NOT_CONFIGURED` (503). There is **no** Sharp substitute and no fake success image.

Fal’s documented `upscale_factor` range is a float from 1 to 4 (default 2). This app only accepts integers 2, 3, and 4. Factor 1 is rejected because it is not an upscale.

This slice did **not** execute live Fal. Adapter HTTP is covered with stubbed `fetch` (success schema, 429, 5xx, timeout, malformed payload, untrusted URL).

## Validation rules

| Check | Error |
| --- | --- |
| `scaleFactor` not 2, 3, or 4 | `UNSUPPORTED_UPSCALE_FACTOR` |
| Source not JPEG/PNG/WebP | `VALIDATION_INVALID_MIME` / `VALIDATION_INVALID_SIGNATURE` |
| Source bytes > `MAX_UPLOAD_BYTES` (default 20 MiB) | `VALIDATION_FILE_TOO_LARGE` |
| `width * scale` or `height * scale` > `MAX_IMAGE_EDGE_PX` (default 8192) or pixel count > `MAX_IMAGE_PIXELS` (default 25e6) | `VALIDATION_IMAGE_TOO_LARGE` |
| Quota would be exceeded | `QUOTA_EXCEEDED` |
| Missing/unowned project or asset | `NOT_FOUND` |
| Live mode, no Fal key | `PROVIDER_NOT_CONFIGURED` |
| Provider result smaller than the source, untrusted host, or non-image | `PROVIDER_REJECTED` |

## Commands run

| Command | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | 113 passed (19 files) |
| `pnpm build` | Pass — includes `/api/jobs`, convert routes unchanged |

No new Prisma migration.

## Tests added

- Mock job → private PNG at 2×/3×/4×; source checksum and dimensions unchanged
- Owner download of the derivative through `/api/storage/objects`; stranger job/download 404; unauthenticated enqueue 401; cross-project asset 404
- Unsupported factors; missing asset; `image/gif`; oversize edge; oversize file; quota full; live without Fal → `PROVIDER_NOT_CONFIGURED`
- Storage put failure → job failed, no derivative, original kept
- Retry reuses `sourceJobId` output
- Fal 429 retried then marked failed; stubbed Fal result smaller than the source → `PROVIDER_REJECTED`
- Mock timeout; Fal 429/5xx/timeout/malformed/untrusted URL without network I/O
- Existing generate, convert, and background-removal suites remain green (regression)

## Security and quota

- Session + same-origin on enqueue. Owner-only asset/job/download.
- No API keys in client bundles or job JSON.
- Provider result hosts allowlisted; user-supplied URLs are not fetched.
- Quota checked at enqueue (source size × scale²) and again before persist (output bytes). `persistDerivedAsset` increments `storageUsedBytes` and deletes the object if the DB write fails.

## Limitations / deferred

- Live Fal smoke (not run; no approval to spend Fal credits). Passing mock tests do not verify Fal quality or exact output dimensions.
- Fal may return a size that is not exactly `scale ×` source; the worker accepts any result that is at least as large as the source and within caps.
- Geometric Sharp upscale is **not** offered in live mode (overridden vs the original plan’s labeled fallback).
- AI edit / object removal (4.4), credits (4.6)
- CONVERT as a BullMQ job
- `Provider` / `AIModel` tables
