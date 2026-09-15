# Integrated shop administration

The existing administrator login opens orders, products, stock, members and operation history. Product changes are used by the public shop and server-side checkout immediately.

- Create a product or a variant, add its description and price, upload up to six photos and select the primary photo. Photos are resized in the browser and stored as validated image blobs in D1.
- New products start with zero stock. Enter stock through stock management with an adjustment reason, then publish the product. Archive removes it from sale while preserving existing orders; it can be published again.
- Stock adjustments use the displayed quantity as a concurrency check. Product edits and order notes also reject stale updates. Successful changes and their audit entries are committed together.
- Orders support search, status filters, internal notes, carrier and tracking number. Existing fulfillment transitions remain protected. Remittance reports are visible but do not confirm receipt; bank reconciliation remains pending.
- Members support search, profile and purchase-history viewing, and suspension/reactivation with a reason. Suspending a member revokes sessions. Administrators cannot suspend themselves or other active administrators here.

## Deployment

Apply schema-commerce.sql and seed-products.sql before deploying the worker. Both are additive. Never rerun the old stock fixture against existing inventory. The product seed preserves current stock and existing product edits.

The current connected deployment uses the historical wugong-test Worker name and staging branch; the owner requests one evolving website. Live collection and the eventual paid-domain connection remain separate tasks.

Validation: 25 Node tests passed, including actual Workers/D1 execution, competing stock updates, checkout catalog guards, session revocation and image blob retrieval. Browser checks covered photo upload, product creation and stock entry using synthetic local data. Existing deployed inventory was preserved: 11 SKUs, 54 available, 1 sold at migration time; these figures are database values, not a physical stock count.
