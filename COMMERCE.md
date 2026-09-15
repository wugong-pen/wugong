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

## Modular back office — 2026-09-15

Apply schema-modules.sql before deploying this revision. It creates shared body inventory at zero, marked unconfirmed, without adding together or modifying old per-variant quantities. An administrator must enter actual available body stock for each existing family under 筆款庫存／影片. Exclude bodies already held for unfinished orders. Old reservations continue to settle or release against their original stock rows; those records are retained for reconciliation, not automatically added to newly confirmed body inventory.

尖型管理 adds or disables reusable nib names. Each product variant selects a nib and its own price. The storefront lists one card per family and switches prices via the variant selector. A disabled nib cannot be checked out, including when it was disabled after a quote.

筆款庫存／影片 edits shared inventory, low-stock threshold and a YouTube URL/embed. Only validated YouTube identifiers are stored. Photo reordering supports dragging or moving forward. Copying a product creates all its variants as unpublished drafts with zero stock. 草稿預覽 renders the current unsaved text/photos within the authenticated editor.

優惠券 supports fixed or percentage-off discounts, eligible-item minimum spend, maximum discount, one selected product family or category (or all products), dates, total quota and enable/disable. One coupon per order and one use per member are enforced on the server in the order transaction. Pending orders hold quota; expiry releases it. Paid claims persist, including after any later refund. Historical order discount snapshots remain after released claims. Discounts exclude shipping and cannot reduce the payable total below NT$1.

Reference for familiar coupon controls: https://help.shopify.com/en/manual/discounts/discount-types/percentage-fixed-amount and https://help.shopify.com/en/manual/discounts/discounts-faq . The owner's single-coupon and once-per-member rules take precedence.

Validation: 28 tests, including Workers/D1 concurrent coupon orders, shared body stock across nibs, failed-transaction rollback, expiry, settlement, safe video parsing and product copies. All browser JavaScript files were syntax checked. Local browser checks verified login, adding a nib, its appearance in product choices, coupon draft saving, stock confirmation and draft preview. No sample coupons or synthetic nibs are added to the deployed database.
