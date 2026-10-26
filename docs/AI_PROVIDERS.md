# AI provider integration

Adapters sit behind operation interfaces. The UI and job worker never call vendor SDKs directly. Model identifiers, sizes, and capabilities are stored in the in-code registry (`lib/ai/registry.ts`) and validated before enqueue. Provider / AIModel database tables remain deferred; disabling a catalog row is `enabled: false` in code until a later slice adds those tables.

Live HTTP calls happen only when the matching server-side API key is set **and** `AI_PROVIDER_MODE` is not `mock`. Mock adapters are compiled for tests and for development when `AI_PROVIDER_MODE=mock` (ignored in production). A passing mock test does not verify a real integration.

Phase 4.5 shipped the registry, factory, normalized errors, and centralized secret access. Sharp convert/resize/crop stays in `lib/images` and is not an AI provider. Phase 4.2–4.4 enable Fal background removal, Fal upscale, OpenAI edit, and Fal object removal. Phase 4.7 routes Fal through the official `@fal-ai/client` queue subscribe helper and adds Stability AI REST v2beta adapters. Live mode never substitutes Sharp when a key is missing. Google remains a stub. There is **no** automatic fallback from a failed Fal call to Stability (or the reverse). Auto-select only picks the first configured provider for that operation.

Sources checked on 14 October 2026:

- [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Imagen shutdown notice](https://ai.google.dev/gemini-api/docs/imagen)
- Fal model pages linked per endpoint below

## Interfaces (conceptual)

```ts
type ImageOperation =
  | "generate"
  | "edit"
  | "removeBackground"
  | "upscale"
  | "removeObject";

interface ModelCapabilities {
  operations: ImageOperation[];
  sizes: string[];          // e.g. "1024x1024"
  maxN: number;
  supportsSeed: boolean;
  supportsNegativePrompt: boolean;
  supportsMask: boolean;
  supportsReferenceImages: boolean;
  outputFormats: Array<"png" | "jpeg" | "webp">;
}

interface ProviderResult {
  images: Array<{ bytes: Buffer; mimeType: string; width: number; height: number }>;
  providerRequestId?: string;
  latencyMs: number;
  estimatedCostUsdMicros?: number;
  rawModel?: string;
}

interface ImageGenerationProvider {
  generate(input: NormalizedGenerateInput, signal: AbortSignal): Promise<ProviderResult>;
}
// analogous: ImageEditingProvider, BackgroundRemovalProvider,
// ImageUpscalingProvider, ObjectRemovalProvider
```

Each adapter must:

1. Validate input against `ModelCapabilities` (reject unsupported size, mask, n, etc.).
2. Use server env credentials only.
3. Enforce `AbortSignal` timeouts from env.
4. Normalize success into `ProviderResult` (download vendor URLs into bytes, never persist vendor URLs as the only copy).
5. Map HTTP 429, 5xx, timeout, and safety blocks to stable error codes.
6. Retry only on `RETRYABLE` codes; never retry validation or safety rejections.
7. Record latency on the job event.
8. Keep vendor-specific fields inside the adapter module.

## Capability matrix (documentation-verified, not live-tested)

| Operation | OpenAI | Google Gemini | Fal AI | Stability AI | Sharp (local) |
| --- | --- | --- | --- | --- | --- |
| Text-to-image | `gpt-image-2.5-flare` | stub | `fal-ai/flux/schnell` (implemented). `fal-ai/flux-2-pro` remains a disabled stub | `POST /v2beta/stable-image/generate/ultra` | No |
| Image-to-image / edit | Images edits + optional mask | stub | Fal EDIT is **not** implemented | `POST /v2beta/stable-image/edit/inpaint` | No |
| Inpaint / mask | Yes (image + mask) | Not assumed | `fal-ai/object-removal/mask` | Inpaint + erase | No |
| Background removal | Not a dedicated API | Not a dedicated API | `fal-ai/bria/background/remove` | `POST /v2beta/stable-image/edit/remove-background` | No |
| Upscale | Not a dedicated API | Not a dedicated API | `fal-ai/flux-vision-upscaler` factors 2\|3\|4 | Fast upscale is **4× only** | Geometric resize only, labeled as non-AI |
| Object removal | Possible via masked edit, not a dedicated erase API | Not assumed | `fal-ai/object-removal/mask` | `POST /v2beta/stable-image/edit/erase` | No |
| Convert / resize / crop / compress | No | No | No | No | Yes |

If the selected model does not list the operation, the API returns `MODEL_CAPABILITY_UNSUPPORTED` and the UI explains that the user should pick another enabled model.

## OpenAI notes

- Prefer Images API with `gpt-image-2.5-sunburst` (precision editing) and `gpt-image-2.5-flare` (fast generation).
- Do not ship `dall-e-3` or `dall-e-2`. Do not default to `gpt-image-1` (deprecated; shutdown 23 October 2026).
- GPT image responses are base64. Persist decoded bytes to object storage; do not expect a durable OpenAI-hosted URL.
- Standard sizes documented for GPT image models include `1024x1024`, `1536x1024`, `1024x1536`; newer GPT Image 2 docs also describe constrained arbitrary `WIDTHxHEIGHT`. The adapter must take allowed sizes from the registry, not from hardcoded guesses in the React tree.
- Seed, `n`, and negative prompt support must be read from capabilities. Do not send unsupported parameters.

## Google notes

- Imagen (`generate_images`) is shut down. Use Gemini image models through `generateContent` with image response modalities.
- Primary candidate: `gemini-nano-banana-2.1`. Optional later: `gemini-3.1-flash-image`, `gemini-3-pro-image`.
- Watermarking (SynthID) is vendor-side; document it in the UI rather than stripping it.
- Do not enable Google in the registry when `GOOGLE_AI_API_KEY` is empty.

## Fal notes

Fal is queue-oriented. Adapters call `@fal-ai/client` `subscribe` (queue + poll) through `lib/ai/providers/fal-client.ts`, then download result URLs from `fal.media` only. Fal result URLs are not a substitute for first-party storage. The official JS client is documented at [fal.ai client setup](https://fal.ai/docs/documentation/model-apis/inference/client-setup).

| Role | Model ID | Inputs | Output | Notes |
| --- | --- | --- | --- | --- |
| Generation | `fal-ai/flux/schnell` | `{ prompt }` | PNG/JPEG/WebP bytes | Verified against official client docs. Metered by Fal account. |
| Generation stub | `fal-ai/flux-2-pro` | — | — | Disabled until the current schema is confirmed live |
| Background removal | `fal-ai/bria/background/remove` | `{ image_url }` data URI | Transparent PNG | Implemented |
| Object removal | `fal-ai/object-removal/mask` | `{ image_url, mask_url }` | PNG | Implemented |
| Upscale | `fal-ai/flux-vision-upscaler` | `{ image_url, upscale_factor }` 2\|3\|4 | PNG | Implemented |
| Edit | — | — | — | Not implemented; do not silently use another Fal model |

## Stability notes

Stability uses REST v2beta at `https://api.stability.ai` with `Authorization: Bearer $STABILITY_API_KEY` and `multipart/form-data`. Docs: [Stable Image Ultra](https://docs.stability.ai/api-reference/generate/stable-image-ultra), [Inpaint](https://docs.stability.ai/api-reference/edit/inpaint), [Erase](https://docs.stability.ai/api-reference/edit/erase), [Remove Background](https://docs.stability.ai/api-reference/edit/remove-background), [Fast Upscale](https://docs.stability.ai/api-reference/upscale/fast).

| Catalog model ID | Endpoint | Operation | Required inputs | Limits |
| --- | --- | --- | --- | --- |
| `stability-image-ultra` | `/v2beta/stable-image/generate/ultra` | GENERATE | `prompt` | ~1 MP output. Vendor: 8 credits / success |
| `stability-image-inpaint` | `/v2beta/stable-image/edit/inpaint` | EDIT | `image`, `prompt`; optional `mask` | ~4 MP output. Vendor: 5 credits / success |
| `stability-remove-background` | `/v2beta/stable-image/edit/remove-background` | REMOVE_BACKGROUND | `image` | PNG |
| `stability-erase` | `/v2beta/stable-image/edit/erase` | REMOVE_OBJECT | `image`, `mask` | Mask white = erase |
| `stability-upscale-fast` | `/v2beta/stable-image/upscale/fast` | UPSCALE | `image` | **4× only**. Factors 2 and 3 are rejected |

Accept header is `application/json` so the adapter can read `finish_reason`. `CONTENT_FILTERED` maps to `SAFETY_REJECTED`. Binary `image/*` responses are also accepted. Vendor credits are **not** our integer user ledger. User billing remains the existing (still-unmerged on this branch) reservation path.

Additional Fal models require the same doc check plus a cost entry before enablement.

## Local processing

Sharp handles convert, resize, crop, compress, and overlay composition for the marketing studio. That path is still a job when the file is large or batched, but it does not call an AI provider and uses a separate, cheaper `OperationPrice`.

Marketing text overlays are composed deterministically (SVG/Sharp), not by asking a model to render glyphs, so overlay position and typography stay user-controlled.

## Error codes

| Code | Retry | User message direction |
| --- | --- | --- |
| `PROVIDER_NOT_CONFIGURED` | No | Ask admin / show setup |
| `MODEL_DISABLED` | No | Pick another model |
| `MODEL_CAPABILITY_UNSUPPORTED` | No | Pick another model or drop the option |
| `VALIDATION_ERROR` | No | Fix input |
| `INSUFFICIENT_CREDITS` | No | Buy credits |
| `RATE_LIMITED` | Yes | Wait / retry |
| `TIMEOUT` | Yes | Retry |
| `PROVIDER_UNAVAILABLE` | Yes | Retry or switch model |
| `SAFETY_REJECTED` | No | Change prompt/image |
| `INTERNAL` | Maybe | Retry once |

## Cost recording

`AIModel.estimatedCostUsdMicros` and `UsageRecord.estimatedProviderCostUsdMicros` are **estimates**. Admin analytics must label them as estimates until a billing export is reconciled. Customer-facing prices live only in `OperationPrice` (credits), never as a copy of vendor USD.

## Phase 3 vs Phase 4

- Phase 3 (shipped): Sharp conversion + OpenAI generate adapter + mock adapter tests + BullMQ worker. Live OpenAI generate has been verified. Without a key, enqueue is `PROVIDER_NOT_CONFIGURED` rather than a fake image.
- Phase 4: edit, background removal, upscale, object removal, product and marketing studios, Google and Fal adapters behind the same interfaces.
