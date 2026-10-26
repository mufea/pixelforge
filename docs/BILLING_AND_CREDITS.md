# Credits and billing

Credits are an integer ledger. Available, reserved, and consumed balances are stored separately. The browser never supplies a balance, a price, or a user id for charging.

**Phase 4.6 first slice** implements reservation, settlement, release, and the two read APIs. See [PHASE_4_6.md](./PHASE_4_6.md). Payments, webhooks, Midtrans, Stripe, packages, and admin grant routes are **not** in this slice. Provisional prices are in `lib/billing/pricing.ts`, not `OperationPrice` rows.

## Invariants

1. **Server authorization.** Every billable operation estimates cost from `OperationPrice` after loading the session and the model.
2. **Reserve then work.** Insert `CreditReservation` (pending) and decrement `availableCredits` / increment `reservedCredits` in one transaction with a row lock (`UPDATE ... WHERE version = $version`) before enqueue.
3. **Insufficient funds reject.** If `availableCredits < estimate`, return `INSUFFICIENT_CREDITS`. Do not enqueue.
4. **One reservation per job.** `CreditReservation.jobId` is unique. Retries reuse it. Workers never create a second reservation for the same job.
5. **Settle only on success.** Default policy (needs approval): on `succeeded`, move reserved credits to consumed: decrement `reservedCredits`, write a negative `CreditLedgerEntry` with reason `settle`, mark reservation `settled`. Charge the estimated amount (which equals the configured price). Do not charge "whatever the provider billed us" to the user.
6. **Release on terminal failure or pre-flight cancel.** Restore `availableCredits`, decrement `reservedCredits`, ledger `release`, reservation `released`. Never release a settled reservation. Never settle a released one.
7. **Cancel after provider submit.** If the vendor call already started and cannot be aborted, finish the attempt; if it succeeds, settle; if it fails, release. Do not double-settle.
8. **Immutable ledger.** `CreditLedgerEntry` has no updates or deletes. Every reserve, settle, release, grant, refund, and admin adjustment is a new row with `balanceAfter` and a unique `idempotencyKey`.
9. **Admin adjustments.** Ordinary users cannot PATCH their balance. Admins write `admin_adjust` ledger rows and an `AuditLog`.
10. **No unlimited plan.** Every plan has a finite grant plus optional purchased packs. Safety valves: per-user concurrency, daily provider budget, `AI_JOBS_ENABLED`.
11. **Payments are webhook-driven.** Browser success URLs are informational. Credits are granted only when a verified webhook (or a verified server-side status poll) records a unique payment as paid.
12. **Webhook idempotency.** `WebhookEvent.(provider, externalEventId)` is unique. Duplicate deliveries return 200 after the first successful process.

## Display

The dashboard shows:

- **Available** — `CreditAccount.availableCredits`
- **Reserved** — in-flight jobs
- **Consumed** — `lifetimeConsumed` for the period plus a ledger history table

Job UI shows **estimated credits** before submit and **settled credits** after success. Those numbers can differ only if an admin changes prices mid-flight; the reservation amount is what settles.

## Plans (seed, admin-editable)

| Slug | Interval | Intended grant (seed defaults) | Notes |
| --- | --- | --- | --- |
| `free` | none | small one-time grant | No auto-renew. Rate limits tighter. |
| `starter` | month or year | modest monthly grant | |
| `pro` | month or year | higher grant | |
| `business` | month or year | highest grant | |

Yearly prices are configured as a separate `Plan` row (`interval = year`), not a client-side multiplier.

Renewal policy options:

- `grant_additional` — add the plan amount each period
- `reset_to` — set unused subscription credits to the plan amount (purchased packs remain; implementation must tag ledger sources so packs are not wiped)
- `none` — packs and free grant only

Exact credit numbers and IDR/USD prices are admin data, not hardcoded in UI.

## Credit packages

One-time `CreditPackage` rows. Purchasing one inserts `Payment` then, after webhook confirmation, a `grant_pack` ledger entry.

## Payment providers

A `PaymentProvider` interface: `createCheckout`, `parseAndVerifyWebhook`, `fetchStatus`.

### Midtrans (Indonesia)

Use **Snap** (standard Midtrans Checkout), not BI-SNAP, unless a later requirement says otherwise.

- Server creates a Snap transaction with `order_id = payment.id`.
- Notification: verify `signature_key = SHA512(order_id + status_code + gross_amount + ServerKey)`.
- Confirm with Midtrans Get Status before granting credits.
- Ignore browser redirect `transaction_status`.
- Map `settlement` / `capture` to paid; `pending` waits; `deny` / `expire` / `cancel` do not grant.

### Stripe

- Checkout Sessions or PaymentIntents created server-side.
- Verify `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`.
- Process `checkout.session.completed` / `invoice.paid` idempotently.
- `STRIPE_PUBLISHABLE_KEY` may be public; the secret key must not.

If a provider is unconfigured, the billing UI shows that checkout is unavailable for that method. It must not fake a paid state.

## Settlement algorithm (worker)

```
in transaction:
  lock CreditAccount
  lock CreditReservation where jobId and status = pending
  if missing: abort (programming error or already terminal)
  if job already succeeded: return (idempotent)
  on success:
    reservedCredits -= n
    lifetimeConsumed += n
    ledger settle
    reservation settled
  on failure/cancel:
    reservedCredits -= n
    availableCredits += n
    ledger release
    reservation released
```

Interrupted workers: `processJob` reclaims `queued` / retryable `failed` / `processing` past `timeoutAt`. A committed job that was never published to Redis stays `queued` with a pending reservation; call `processJob` or `enqueueJob` with the same id. Timeouts, other retryable provider codes, and storage failures (`STORAGE_UNAVAILABLE`, `STORAGE_NOT_CONFIGURED`) keep the hold. That includes the case where the provider already returned bytes and private storage then rejected the write: do not settle and do not release. After the attempt cap those jobs may be `failed` while the reservation stays `pending` for reconciliation — they are not auto-refunded. Recovery must not settle twice. This is the existing D4 release policy applied to infrastructure failures; credit prices are unchanged.

## Analytics

Admin revenue figures come from `Payment` rows in a paid status. Provider cost is the sum of `UsageRecord.estimatedProviderCostUsdMicros` and must be labeled **estimate**. Gross margin by plan is credits settled × implied credit FX versus estimated provider USD — also an estimate.
