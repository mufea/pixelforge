# Phase 4.4 — AI edit / object removal

**Result: PASS** (16 October 2026). Provider-backed `EDIT` and `REMOVE_OBJECT` jobs on owned JPEG/PNG/WebP assets. Outputs are private `DERIVATIVE` assets. The source is not deleted or modified. No Prisma migration. No live OpenAI/Fal/Google calls in this slice.

Builds on Phase 4.5 (factory/registry) and the 4.2/4.3 job pattern. Convert, generate, background removal, and upscale remain unchanged.

## Why no database migration

`AIJob.operation` is already a string. `Asset.kind` already includes `DERIVATIVE`. `sourceAssetId` / `sourceJobId` already exist. Masks are owned PNG assets in the same project (Phase 2 upload path). Provider/AIModel tables stay deferred.

## API contract

`POST /api/jobs` (session + same-origin), in addition to `GENERATE`, `REMOVE_BACKGROUND`, and `UPSCALE`:

```json
{
  "operation": "EDIT",
  "projectId": "<uuid>",
  "assetId": "<uuid>",
  "prompt": "make the mug blue",
  "maskAssetId": "<uuid>"
}
```

`maskAssetId` is optional for `EDIT`. Prompt is 3–2000 characters.

```json
{
  "operation": "REMOVE_OBJECT",
  "projectId": "<uuid>",
  "assetId": "<uuid>",
  "maskAssetId": "<uuid>"
}
```

`maskAssetId` is required for `REMOVE_OBJECT`. The mask must be a PNG with the same pixel dimensions as the source. White pixels (RGB > 200) mark the area to remove. Missing mask → `MASK_REQUIRED`. Using the source id as the mask → `VALIDATION_MASK`. Wrong size → `VALIDATION_MASK_SIZE`. All-black mask → `VALIDATION_MASK_EMPTY` at process time.

Response `201` is the existing `publicJob` shape. Poll `GET /api/jobs/:id` (owner-only). Storage keys and provider secrets are never included.

## Provider routing

| Operation | Test / mock | Live | Missing key |
| --- | --- | --- | --- |
| `EDIT` | `mock-edit` (deterministic border tint, same size) | OpenAI `POST /v1/images/edits`, model `gpt-image-2.5-flare`, multipart `image` + `prompt` + optional PNG `mask` | `PROVIDER_NOT_CONFIGURED` |
| `REMOVE_OBJECT` | `mock-object-remove` (fills white mask pixels) | Fal `POST https://fal.run/fal-ai/object-removal/mask`, `{ image_url, mask_url }` data URIs. Documented response is `images[]`. | `PROVIDER_NOT_CONFIGURED` |

There is **no** Sharp substitute. Vendors are not swapped silently. Prompt-based “remove the chair” is `EDIT`. Dedicated object removal is mask-based because that is the verified Fal API; Fal does not accept a text prompt on `fal-ai/object-removal/mask`.

This slice did **not** execute live OpenAI or Fal. Adapter HTTP is stubbed (success schema, 429, timeout, untrusted URL).

## Validation and security

- Session + same-origin on enqueue. Owner-only project/asset/mask/job/download. Cross-tenant and cross-project → 404.
- Source: JPEG/PNG/WebP, size vs `MAX_UPLOAD_BYTES`, quota at enqueue and before persist.
- Mask bytes loaded after `assertOwnedStorageKey`. User-supplied URLs are never fetched. Fal result hosts must be `https` on `fal.media` / `*.fal.media`.
- Worker sanitizes provider output, persists `DERIVATIVE` with `sourceAssetId` + `sourceJobId`, reuses existing output for the same job, rolls back storage on persist failure.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | 133 passed (21 files) |
| `pnpm build` | Pass — includes `/api/jobs`, convert routes unchanged |

No new Prisma migration.

## Tests added

- Mock edit and mock object-removal jobs → private derivatives; source checksum unchanged
- Owner download; stranger job/download 404; unauthenticated enqueue 401
- Short prompt; missing/self/mismatched/empty mask; invalid mime; quota
- Live without keys → `PROVIDER_NOT_CONFIGURED` (no fetch)
- Storage put failure → no derivative; retry reuses `sourceJobId`
- Fal 429 retried then failed; untrusted result URL not fetched
- Existing generate, convert, background-removal, and upscale suites remain green

## Limitations / deferred

- Live OpenAI edit and live Fal object-removal smokes were not run (no approval to spend credits). Passing mock tests do not verify vendor quality or exact output size.
- OpenAI edit may return a fixed studio size (for example 1024×1024) rather than the source dimensions. The worker persists the sanitized provider bytes if they are within caps.
- Fal object removal is mask-only. Optional `maskAssetId` on `EDIT` is supported by the API; the project card UI ships prompt-only edit plus a paint/upload mask workflow for object removal.
- Painted masks are stored through the existing upload intent path (library PNG).
- Credits / payments (4.6), CONVERT as a BullMQ job, `Provider` / `AIModel` tables
