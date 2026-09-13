# Secure checkout (staging only)

Server catalog prices and quantities determine the TWD total. Client product names,
prices and totals are not trusted. Existing sandbox shipping remains NT$0; overseas
shipping prices and promotions remain separate, unfinished work.

Apply `schema-checkout.sql` to **wugong-orders-test** before deploying. Then apply
`seed-inventory-staging.sql`: 11 variants, 5 test units each. Inserts never reset
existing quantities. Production data and credentials must not be used.

Order creation, member association and per-SKU reservations share one D1 batch.
SQLite quantity constraints reject insufficient stock and roll back the entire order. Duplicate
SKU lines are aggregated; member-scoped request keys make retries idempotent.

Unstarted online orders reserve for 30 minutes; bank orders reserve for 3 days.
Starting payment locks the reservation. Verified PayPal capture receipts, sold
quantities and the order status are committed atomically. Provider transaction IDs
are unique and replay cannot sell the same reservation twice.

PayPal is checked via authenticated sandbox API both before capture (order, currency,
amount) and after capture (completed final capture, reference/custom IDs, currency,
amount, capture ID). Browser return parameters alone never mark an order paid.
Every 5 minutes, scheduled execution expires safe unpaid reservations and polls up
to 10 pending PayPal orders, rotating by last check. Already-completed captures can
therefore recover after a lost browser response. Polling does not initiate capture.

Uncertain online results remain reserved and require reconciliation; they are never
blindly released on timeout or browser cancellation. Failed payment creation without
a stored provider ID requires manual review. Bank reports do not mark payment paid;
reported bank reservations remain held for the future administrator reconciliation
workflow. Legacy orders without reservations cannot initiate new payment and must
be reviewed or replaced; previous completed orders remain unchanged.

LINE Pay remains disabled. ECPay's old public shared test merchant key cannot provide
private notification authenticity, so its form and notification route are disabled.
TW bank transfer and JP/KR/US/SG PayPal sandbox remain available when configured.

Validation: `node --test *.test.mjs` covers pricing, membership isolation, bank
ownership, atomic multi-item rollback, duplicate SKUs, overselling, repeated receipts,
receipt reuse, expiry and reported bank holds, PayPal validation/reconciliation,
and real Miniflare/D1 parallel distinct and identical checkout requests.

Local Windows sandbox bundler fallback: `node build-local.mjs`. The normal deployment
build remains the existing Wrangler build on Cloudflare.

Pre-migration test DB recovery bookmark (2026-09-12):
`00000012-00000000-000050e4-727e9f10abd69fdcb47f7b69a7a0a4b1`.
Do not restore this automatically: it would also revert later test data.
