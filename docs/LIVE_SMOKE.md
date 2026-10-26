# Live provider smoke-test procedure

Do **not** run these tests unless a human explicitly authorizes paid Fal and/or Stability calls. Phase 4.9 did not execute them.

## Isolation

| Command | Includes `tests/live` | Calls vendors |
| --- | --- | --- |
| `pnpm test` | no (`vitest.config.ts` include is `tests/unit` + `tests/integration` only) | no |
| `pnpm test:live` | yes (`vitest.live.config.ts`) | only when `PIXELFORGE_LIVE_PROVIDERS=1` **and** the matching key is set |

`tests/live/fal-stability.live.test.ts` uses `describe.skipIf(!LIVE)` and `it.skipIf(!FAL)` / `it.skipIf(!STABILITY)`. A skipped file or case is **not** a pass. Do not report live verification from a skip.

## Guards already in the file

- Flag: `PIXELFORGE_LIVE_PROVIDERS=1`
- Credentials: `FAL_KEY` or `FAL_API_KEY`; `STABILITY_API_KEY`
- Inputs: 64×64 PNG (and a 16×16 white square on a 64×64 mask)
- Timeout: 60s per case via `AbortSignal.timeout` and the suite timeout
- Retries: none configured (Vitest default is no retry)
- Logging: assertions check byte length, dimensions, and magic bytes only. Do not add `console.log` of result URLs, hosts, or keys.

## Operations covered

| Provider | Operation | Model / route |
| --- | --- | --- |
| Fal | GENERATE | `fal-ai/flux/schnell` |
| Fal | EDIT | `fal-ai/flux-kontext/dev` |
| Fal | IMAGE_TO_IMAGE | `fal-ai/flux/dev/image-to-image` |
| Stability | GENERATE | `POST /v2beta/stable-image/generate/ultra` |
| Stability | EDIT / inpaint | `POST /v2beta/stable-image/edit/inpaint` |
| Stability | REMOVE_OBJECT | `POST /v2beta/stable-image/edit/erase` |
| Stability | REMOVE_BACKGROUND | `POST /v2beta/stable-image/edit/remove-background` |
| Stability | UPSCALE 4× | `POST /v2beta/stable-image/upscale/fast` |

Published list prices change. Treat any dollar figures in the test comment as estimates, not a bill.

## Manual execution (authorized environments only)

1. Confirm authorization to spend Fal and/or Stability credit.
2. Confirm the target is a non-production or explicitly approved account.
3. Export only the keys you intend to use. Do not paste keys into tickets, logs, or screenshots.

```bash
export PIXELFORGE_LIVE_PROVIDERS=1
# export FAL_KEY=...
# export STABILITY_API_KEY=...
pnpm test:live
```

4. Record, for each **executed** case: operation, model, pass/fail, duration, and HTTP/provider error code if it failed. Do not record keys or signed URLs.
5. Unset the flag and keys when finished: `unset PIXELFORGE_LIVE_PROVIDERS FAL_KEY STABILITY_API_KEY`.
6. If a case is skipped because a key is missing, write "skipped — not verified", not PASS.

There is no CI job for `pnpm test:live`.
