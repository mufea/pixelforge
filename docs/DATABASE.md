# Database design

PostgreSQL is the system of record. Prisma ORM (pinned to v7 in Phase 1 for Better Auth adapter compatibility) owns the schema. Migrations are forward-only. Applied: `phase1_foundation`, `phase2_projects_assets`.

All primary keys are UUID (`uuid` / `@db.Uuid` or `cuid` — **proposed: UUID v7** for time-locality on jobs and assets). Every user-owned row includes `userId` and is queried with that constraint. Soft-delete (`deletedAt`) is used for projects, assets, API keys, and users (account deletion grace). Credit ledger rows are never soft-deleted or updated.

## Ownership rule

Every query that returns a project, asset, job, reservation, payment, or API key for a non-admin actor **must** include `userId = session.user.id` (or an equivalent join that is equally strict). Changing a UUID in the URL must yield 404, not 403 with existence leakage where practical, and never another tenant's bytes.

## Better Auth tables

Generated/maintained by Better Auth CLI, then migrated with Prisma:

| Model | Purpose |
| --- | --- |
| `User` | Identity: email, name, emailVerified, image, role |
| `Session` | Server sessions |
| `Account` | OAuth and credential links |
| `Verification` | Email verify and password reset tokens |

Application profile data that Better Auth should not own lives in `UserProfile`.

## Domain models

### Identity and tenancy

```
UserProfile
  id, userId (unique FK User)
  displayName, locale, timezone
  role echo is not trusted; User.role is canonical
  storageUsedBytes
  deletedAt, createdAt, updatedAt
```

### Projects and assets

```
Project
  id, userId
  name, description
  deletedAt, createdAt, updatedAt
  @@index(userId, updatedAt)

Asset
  id, userId, projectId? (nullable for unfiled generations)
  kind: ORIGINAL | GENERATED | MASK | DERIVATIVE
  mimeType, byteSize, width, height, checksumSha256
  storageKey          # server-generated, never user path
  originalFilename    # display only
  sourceJobId?
  deletedAt, createdAt, updatedAt
  @@unique(storageKey)
  @@index(userId, createdAt)
  @@index(projectId)

AssetVersion
  id, assetId, userId
  version
  mimeType, byteSize, width, height
  storageKey
  parentVersionId?
  createdAt
  @@unique(assetId, version)
```

Original uploads are preserved. Edits write a new `Asset` or `AssetVersion`; they do not overwrite storage keys.

### Jobs

```
AIJob
  id, userId
  operation           # GENERATE | EDIT | REMOVE_BACKGROUND | UPSCALE |
                      # REMOVE_OBJECT | CONVERT | PRODUCT_STUDIO | MARKETING_STUDIO
  status              # queued | processing | succeeded | failed | cancelled
  providerId, modelId
  inputJson           # validated metadata, no bytes
  outputAssetIds      # UUID[]
  reservationId
  attemptCount
  errorCode, errorMessage  # message is safe/normalized
  startedAt, finishedAt, cancelledAt
  timeoutAt
  createdAt, updatedAt
  @@index(userId, createdAt)
  @@index(status, createdAt)
  @@index(providerId, createdAt)

AIJobEvent
  id, jobId
  fromStatus, toStatus
  attempt
  payloadJson         # metrics, provider request id (not secrets)
  createdAt
  @@index(jobId, createdAt)
```

### Provider registry

```
Provider
  id, slug (unique)    # openai | google | fal | mock | sharp
  name, enabled
  budgetUsdCents?
  createdAt, updatedAt

AIModel
  id, providerId
  slug                 # vendor model id, unique per provider
  displayName
  operations           # string[] of supported operations
  capabilitiesJson     # sizes, seed, n, mask, negativePrompt, formats
  enabled
  estimatedCostUsdMicros   # provider cost estimate, not customer price
  createdAt, updatedAt
  @@unique(providerId, slug)

OperationPrice
  id
  operation, modelId?
  creditCost           # integer credits charged on success
  unit                 # per_image | per_megapixel | flat
  active
  createdAt, updatedAt
```

Admin enable/disable toggles `Provider.enabled` and `AIModel.enabled`. Frontends read the registry.

### Credits and billing

```
CreditAccount
  id, userId (unique)
  availableCredits     # integer, excluding reserved
  reservedCredits      # integer
  lifetimeGranted
  lifetimeConsumed
  version              # optimistic concurrency
  createdAt, updatedAt

CreditReservation
  id, userId, accountId
  jobId? (unique when set)
  credits
  status               # pending | settled | released | expired
  createdAt, updatedAt, settledAt, releasedAt
  @@index(userId, status)

CreditLedgerEntry
  id, userId, accountId
  reservationId?
  delta                # signed integer; negative = consume
  balanceAfter
  reason               # grant_plan | grant_pack | reserve | settle |
                       # release | admin_adjust | refund
  actorUserId?         # admin id for adjustments
  idempotencyKey (unique)
  metadataJson
  createdAt
  @@index(userId, createdAt)
  # no updatedAt — immutable

Plan
  id, slug (unique)
  name                 # free | starter | pro | business
  interval             # month | year | none (pack)
  priceAmount, currency
  creditsGranted
  renewalPolicy        # grant_additional | reset_to | none
  active, sortOrder
  createdAt, updatedAt

CreditPackage
  id, slug
  name, credits, priceAmount, currency, active
  createdAt, updatedAt

Subscription
  id, userId
  planId
  status               # trialing | active | past_due | canceled | expired
  provider             # stripe | midtrans | manual
  providerSubscriptionId?
  currentPeriodStart, currentPeriodEnd
  cancelAtPeriodEnd
  createdAt, updatedAt
  @@index(userId, status)

Payment
  id, userId
  provider             # stripe | midtrans
  providerPaymentId
  amount, currency, status
  creditPackageId?, planId?
  creditsGranted
  rawEventId?
  createdAt, updatedAt
  @@unique(provider, providerPaymentId)

WebhookEvent
  id
  provider
  externalEventId
  payloadJson          # no secrets
  signatureValid
  processedAt
  processingError
  createdAt
  @@unique(provider, externalEventId)

UsageRecord
  id, userId, jobId
  operation, providerId, modelId
  creditsSettled
  estimatedProviderCostUsdMicros
  createdAt
  @@index(createdAt)
  @@index(modelId, createdAt)
```

### API keys (created when PUBLIC_API_ENABLED, hashed at rest)

```
ApiKey
  id, userId
  name
  keyPrefix            # display, e.g. pf_live_ab12
  keyHash              # sha256
  scopes               # string[]
  lastUsedAt, revokedAt
  createdAt
  @@index(userId)
```

### Audit and settings

```
AuditLog
  id
  actorUserId
  action               # credit.adjust | provider.disable | user.role | ...
  targetType, targetId
  beforeJson, afterJson
  ip, userAgent
  createdAt
  @@index(actorUserId, createdAt)
  @@index(targetType, targetId)

SystemSetting
  key (pk), valueJson, updatedAt, updatedById
```

## Indexes for frequent paths

- Job list by user and createdAt
- Job monitor by status
- Ledger by user and createdAt
- Unique webhook (provider, externalEventId)
- Unique payment (provider, providerPaymentId)
- Unique reservation-per-job
- Asset storageKey unique
- Session token unique (Better Auth)

## Retention

Configurable via `SystemSetting`:

- Soft-deleted assets: purge storage after N days
- Abandoned uploads (no completed Asset): delete after 24 hours
- Job input JSON: retain with the job; strip prompt on account deletion if configured
- Webhook payloads: 90 days
- Audit logs: 365 days minimum

Account deletion: schedule anonymization of User, cascade soft-delete of projects/assets, revoke sessions and API keys, retain ledger rows with userId replaced by a tombstone for financial audit where legally required.

## Migration policy

- Prisma migrations in `prisma/migrations`, applied with `prisma migrate deploy` in production.
- Never edit an applied migration.
- Seed (`prisma/seed.ts`) creates plans, operation prices, providers/models, and a local admin only in development.
