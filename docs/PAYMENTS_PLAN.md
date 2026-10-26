# Stripe and Midtrans implementation plan

**Status:** plan only. Do not mark payments complete. Env placeholders exist (`STRIPE_*`, `MIDTRANS_*`). There is no `Payment` / `WebhookEvent` Prisma model, no checkout route, and no webhook handler on this branch. Credit grants today are `grantCredits` (tests / future admin) with no HTTP purchase path.

This plan depends on the recovered Phase 4.6 ledger (`CreditAccount`, append-only `CreditLedgerEntry`, unique `idempotencyKey`). Do not implement a second balance table.

## Existing contracts to keep

- Integer credits (D10). Server computes pack/plan amounts; never trust client `credits`, `amount`, or `planId` as a price.
- D4 settlement stays job-side. Payments only **grant** available credits after authenticated confirmation.
- `GET /api/credits` remains read-only.
- `STRIPE_PUBLISHABLE_KEY` may be public. Secret keys stay server-only, never `NEXT_PUBLIC_`.
- Webhook routes must not run `assertSameOrigin` (provider servers are not the app origin). They must verify signatures instead.

## Recommended slice (separately reviewable)

1. **Schema.** Additive Prisma models: `CreditPackage`, `Payment`, `WebhookEvent` as already sketched in `docs/DATABASE.md`. Unique `(provider, externalEventId)`. Do not reuse `CreditReservation` for purchases.
2. **Server checkout.** `POST /api/billing/checkout` authenticates the user, loads the package/plan from the database, and creates:
   - Stripe Checkout Session (test mode first) with `client_reference_id = payment.id` and amount from the package row.
   - Midtrans Snap transaction with `order_id = payment.id` and `gross_amount` from the same row.
3. **Pending payment.** Insert `Payment` (`pending`) before calling the provider. Do not grant credits yet.
4. **Webhooks.**
   - Stripe: raw body + `Stripe-Signature` + `STRIPE_WEBHOOK_SECRET`. Handle `checkout.session.completed` / `invoice.paid`.
   - Midtrans: verify `signature_key = SHA512(order_id + status_code + gross_amount + ServerKey)`, then Get Status before grant.
5. **Idempotent grant.** On first verified paid event: `grantCredits(userId, package.credits, \`pay:${payment.id}\`)` inside the same DB transaction that marks `Payment` paid and inserts `WebhookEvent`. Duplicate deliveries return 200 and do not grant again.
6. **Failures.** `deny` / `expire` / `cancel` / expired Checkout: mark payment failed, no grant. Pending stays pending until a verified terminal status.
7. **Refunds.** Provider refund webhook writes a new ledger `release` or a dedicated `refund` reason (additive; do not update old grant rows). Do not auto-delete jobs or assets.
8. **Tests.** Mock Stripe/Midtrans HTTP. Cover signature rejection, duplicate webhook, amount mismatch, and unauthorized checkout. No live charges in `pnpm test`.

## Prerequisites before coding that slice

- Credit ledger tests still green on this branch
- Chosen pack SKUs and IDR/USD amounts stored as seed data, not client literals
- Stripe test-mode account + webhook secret
- Midtrans sandbox server key + merchant id
- Explicit authorization to create webhook endpoints

## Out of scope until that slice is approved

Checkout UI polish, customer portal, dunning, tax, and production webhook URLs.
