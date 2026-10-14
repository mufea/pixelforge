# AI provider integration

Adapters sit behind operation interfaces. The UI and job worker never call vendor SDKs directly. Model identifiers, sizes, and capabilities are stored in the registry and validated before enqueue.

Live HTTP calls happen only when the matching server-side API key is set **and** `AI_PROVIDER_MODE` is not `mock`. Mock adapters are compiled for tests and for development when `AI_PROVIDER_MODE=mock` (ignored in production). A passing mock test does not verify a real integration.

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

| Operation | OpenAI | Google Gemini | Fal AI | Sharp (local) |
| --- | --- | --- | --- | --- |
| Text-to-image | `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`; `gpt-image-2` still listed | `gemini-nano-banana-2.1` via `generateContent` | `fal-ai/flux-2-pro` | No |
| Image-to-image / edit | Images edits + reference images; mask inpainting supported | Conversational edit with image parts | FLUX.2 [pro] edit endpoints | No |
| Inpaint / mask | Yes (image + mask) | Not assumed; UI must hide if registry says no | `fal-ai/flux-pro/v1/fill`, `fal-ai/object-removal/mask` | No |
| Background removal | Not a dedicated API | Not a dedicated API | `fal-ai/bria/background/remove`, BiRefNet | No |
| Upscale | Not a dedicated API | Not a dedicated API | `fal-ai/flux-vision-upscaler`, `fal-ai/topaz/upscale/image` | Geometric resize only, labeled as non-AI |
| Object removal | Possible via masked edit, not a dedicated erase API | Not assumed | `fal-ai/object-removal/mask`, `fal-ai/flux-pro/v1/erase` | No |
| Convert / resize / crop / compress | No | No | No | Yes |

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

Fal is queue-oriented. The worker should use the official client with a timeout, then download the result URL into our bucket. Fal result URLs are not a substitute for first-party storage.

Proposed first Fal models (IDs confirmed on fal.ai pages, access not verified):

| Role | Model ID |
| --- | --- |
| Generation | `fal-ai/flux-2-pro` |
| Background removal | `fal-ai/bria/background/remove` |
| Object removal (mask) | `fal-ai/object-removal/mask` |
| Upscale | `fal-ai/flux-vision-upscaler` |

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

- Phase 3: Sharp conversion + one live adapter (OpenAI generate) + mock adapter tests + job worker.
- Phase 4: edit, background removal, upscale, object removal, product and marketing studios, Google and Fal adapters behind the same interfaces.
