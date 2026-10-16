# Phase 4.5 — Provider adapter architecture

**Result: PASS** (16 October 2026). In-code registry and factory only. No Fal/OpenAI live calls. No Prisma migration. Sharp convert/resize/crop is unchanged and is not an AI provider.

Phase 4.1 conversion remains functional: `POST /api/assets/:id/convert` and `POST /api/projects/:id/convert` are still in the production build and conversion tests still pass.

## Why no database migration

`docs/DATABASE.md` still describes `Provider` / `AIModel` / `OperationPrice` tables. This slice does **not** add them. An in-code catalog (`lib/ai/registry.ts`) with `enabled` and `implemented` flags is enough to select providers, refuse stubs, and keep enqueue fail-closed. A migration would be required only when admin UI needs to disable a model without a deploy; that is not in 4.5 scope.

## Architecture

| Piece | Role |
| --- | --- |
| `lib/ai/types.ts` | Provider ids, operations, capabilities, `ProviderResult`, generation adapter |
| `lib/ai/errors.ts` | Normalize 429 / 5xx / safety / abort → `DomainError`; retryable set includes `TIMEOUT` |
| `lib/ai/config.ts` | Server-only timeouts and *whether* keys exist. Credential getters for adapters only. Public status is booleans |
| `lib/ai/registry.ts` | In-code catalog. Fal/Google rows `enabled: false`, `implemented: false` |
| `lib/ai/factory.ts` | Auto-select (mock if allowed, else OpenAI) or explicit `providerId` |
| `lib/ai/generate.ts` | Re-exports the factory so existing imports stay valid |
| `lib/ai/providers/mock.ts` | Test/dev generate; honors abort |
| `lib/ai/providers/openai-generate.ts` | Existing generate adapter; credentials and HTTP error mapping go through config/errors |
| `lib/ai/providers/fal.ts` / `google.ts` | Stubs that throw `MODEL_CAPABILITY_UNSUPPORTED` and never fetch |
| `lib/images/convert.ts` | Unchanged. Convert is not an `IMAGE_OPERATIONS` value |

Worker `processJob` still only runs `GENERATE`. Other catalog operations fail with `MODEL_CAPABILITY_UNSUPPORTED`. Existing output reuse still happens **before** provider resolution so a retry does not require a live key.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | 81 passed (15 files) |
| `pnpm build` | Pass — includes `/api/assets/[id]/convert`, `/api/projects/[id]/convert`, `/api/jobs` |

No new Prisma migration.

## Tests added

- Auto-select mock; explicit OpenAI when configured; unknown provider `VALIDATION`
- Live mode with no keys → `PROVIDER_NOT_CONFIGURED` (HTTP 503)
- Missing Fal/Google keys → `PROVIDER_NOT_CONFIGURED`
- Public runtime config does not include secret values
- HTTP 429 / 5xx / safety mapping; retryable codes include `TIMEOUT`
- Catalog stubs → `MODEL_DISABLED`
- AbortError / TimeoutError / aborted OpenAI fetch / aborted mock → `TIMEOUT`
- Mock generate through the factory returns a 32×32 PNG
- Fal/Google stubs do not call `fetch`
- Existing convert and generate job tests still pass

## Live vendor calls

None in this slice. OpenAI generate was already verified in Phase 3. Fal and Google adapters do not open network connections.

## Limitations / deferred

- Background removal, AI upscale, edit, object removal (4.2–4.4)
- Credits / payments (4.6)
- `Provider` / `AIModel` database tables
- CONVERT as a BullMQ job (batch convert remains sync HTTP from 4.1)
- Live Fal or Google HTTP
