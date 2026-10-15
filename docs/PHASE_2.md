# Phase 2 — Projects, uploads, private storage

**Result: PASS** (15 October 2026)

D1–D10 remain in force. This phase adds owned projects, validated private uploads, and isolation tests. Sharp is used only to decode, bound dimensions, and strip metadata. It is not a user-facing converter. No AI providers were added.

## Implementation

- `Project`, `Asset`, `AssetVersion`, `UploadIntent` plus `UserProfile.storageUsedBytes`
- Server-owned object keys: `users/{userId}/uploads/{intentId}` and `users/{userId}/assets/{assetId}/v1`
- Upload slot → PUT bytes → complete. Complete reads storage, checks magic bytes, sanitizes, then creates `Asset`. Failures delete the object and never insert an `Asset`
- Download URLs are short-lived and issued only after `userId = session.user.id`
- Cross-tenant project/asset/intent access returns 404
- Local/HMAC storage when S3 is unset in development; S3 when fully configured; production without S3 fails uploads with `STORAGE_NOT_CONFIGURED`
- Workspace UI: project list/create/detail, uploader, empty/loading/error/not-found states

## Commands run

| Command | Result |
| --- | --- |
| `pnpm exec prisma migrate dev --name phase2_projects_assets` | Applied `20261015104404_phase2_projects_assets` |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | 33 passed (9 files) |
| `pnpm build` | Pass |

## Tests added

- Tenant isolation for projects, assets, download URLs, and complete
- Magic-byte / MIME / extension rejection
- Oversized image rejection
- Quota rejection
- Unauthenticated upload slot (401)
- Original filename is not the storage key
- Same-origin guard

## Limitations

- MinIO/S3 is used when `S3_*` is complete. This environment uses private local/HMAC storage in development.
- Abandoned-upload sweeper is not a scheduled job; expired intents are rejected on complete.
- Sharp conversion UI, AI jobs, credits, and payments remain out of scope.
- Upload rate limit is in-process, not Redis.

## Blockers

None that prevent Phase 3 (Sharp convert tool + first AI job). Phase 3 must not start until this report is accepted.
