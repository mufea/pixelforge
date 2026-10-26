# Phase 4.8 — Credits recovery, Fal edit/i2i, ZIP export, Next.js patch

**Result:** recorded after local checks in this slice. Live Fal, live Stability, and a live Render deploy were **not** run unless a later report says otherwise. Mock and database-backed tests exercise credits, Fal request construction, ZIP ownership, and Next.js build. Do not treat that as a live provider PASS or a production deploy PASS.

## Slice A — verified starting state

Working branch: `cursor/fal-stability-render-c224` at `9b4d3f5` before this slice (Phase 4.7). Credits existed only on closed PR #1 (`cursor/phase-46-credits-billing-e526`, commit `be9932a`). Merge-base of both branches was `feb5cba`. PR #3 remains open against `feat/phase-4-6-credit-billing` and is not merged. `main` remains behind Phase 4.6/4.7.

Cherry-pick of `be9932a` was the recovery path: one commit, no second ledger, processor/factory overlap resolved by keeping Phase 4.7 Fal subscriber test hooks **and** `grantCredits`.

## Credits (recovered, not rewritten)

Integer reserved-then-settled ledger from Phase 4.6:

- `CreditAccount` / `CreditReservation` / `CreditLedgerEntry`
- `FOR UPDATE` + `availableCredits >= cost` CAS
- Idempotent reserve/settle/release keys
- D4: settle on success, release on confirmed terminal failure
- Retryable failures keep the hold
- `GET /api/credits` and `GET /api/credits/ledger`
- `grantCredits` has no HTTP route

AI jobs (`GENERATE`, `EDIT`, `REMOVE_BACKGROUND`, `REMOVE_OBJECT`, `UPSCALE`, `IMAGE_TO_IMAGE`) reserve inside `createQueuedBillableJob`. Convert/resize/crop stay free.

## Fal editing and image-to-image

Documented models (not invented):

| Operation | Model | Required input |
| --- | --- | --- |
| EDIT (unmasked) | `fal-ai/flux-kontext/dev` | `prompt`, `image_url` |
| IMAGE_TO_IMAGE | `fal-ai/flux/dev/image-to-image` | `prompt`, `image_url`; optional `strength` 0.01–1 |

Masked Fal EDIT is `MODEL_CAPABILITY_UNSUPPORTED` (no mask field on kontext/dev). OpenAI and Stability remain the masked-edit providers. Auto-select for EDIT is OpenAI → Stability → Fal. IMAGE_TO_IMAGE auto-select is Fal only.

Provisional credit cost for `IMAGE_TO_IMAGE` is 10 (same as GENERATE/EDIT).

## ZIP export

`POST /api/projects/:id/export` streams a STORE ZIP of owned `DERIVATIVE` / `GENERATED` assets. Originals are rejected. Entry names are sanitized and prefixed with an asset-id slice. Limits: `ZIP_EXPORT_MAX_FILES` (default 50) and `ZIP_EXPORT_MAX_BYTES` (default 100 MiB). Bytes come from private storage; the response does not include public object URLs.

## Next.js security

Installed Next.js was **16.4.0**. Advisories:

- GHSA-2464-fhr4-w9xw / CVE-2026-96889 — Image Optimization RCE via sharp/librsvg (fixed 16.4.1, sharp >= 0.35.5)
- GHSA-673q-mjm6-r5xr — `use cache` RCE (fixed 16.4.1)
- GHSA-p3m5-59mp-jv5r — Server Actions DoS (fixed 16.4.1)

Authoritative guidance: [Next.js security update 14 October 2026](https://nextjs.org/blog/nextjs-security-update-october-14-2026). Patch line for this app is **16.4.1**, not a major upgrade. Matching React 19.3 line patch is **19.3.1** (GHSA-xqc2-xf4c-x3h3 / GHSA-h3gv-c5rc-p453). `sharp` remains **0.35.5**.

## Live smokes (opt-in)

`pnpm test` never calls Fal or Stability. `pnpm test:live` runs `tests/live/` only when `PIXELFORGE_LIVE_PROVIDERS=1` and the matching secret is set. Bounded timeout (60s). No automatic unbounded retries. Results are not claimed passed unless that command was actually executed.

## Render

`render.yaml` is still a Blueprint only. No production services were created in this slice. See [DEPLOYMENT.md](./DEPLOYMENT.md) and [PAYMENTS_PLAN.md](./PAYMENTS_PLAN.md).

## Explicitly not in this slice

- Merging PR #1 or PR #3
- Stripe / Midtrans implementation (plan only)
- Live provider execution by default
- Render deploy or production secret changes
