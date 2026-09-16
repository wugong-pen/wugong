# Administrator access

This change uses the existing registered member credentials for an explicitly granted administrator. There is no default password, public administrator registration, automatic first-user grant, or client-controlled role. Confirm the owner-selected existing member record before granting it. Never create a password on the owner's behalf.

## Installation

1. Apply `schema-admin.sql` to the database bound to the deployment, after `schema-members.sql`. The migration is additive and repeatable.
2. Deploy the updated Worker and assets together. `run_worker_first = true` must remain enabled. Keep backend files excluded from static assets.
3. The owner registers their email through the member page, if it is not already registered, and sets their own password.
4. Generate the grant SQL with `node admin-provision.mjs grant <owner-email>`. Execute the generated SQL using an authenticated D1 administration connection to the same database. Confirm that the final SELECT returns exactly the intended email with active=1. No result means no account was granted.
5. Open `/admin-login.html`. Sign in with the authorized email and existing member password.

To remove access, generate SQL with `node admin-provision.mjs revoke <owner-email>` and execute it on the same database. Revocation deletes existing administrator sessions; every request also checks the current active member and grant.

## Security behavior

- Administrator sign-in requires a separate password check and uses a separate Secure/HttpOnly/SameSite=Strict cookie, with a fixed one-hour lifetime. Member cookies cannot access administrator APIs, even for the owner.
- Session tokens are random and hashed in storage. Password changes/resets invalidate administrator sessions by comparing the stored password snapshot against the current member password hash. Disabling a member or administrator grant takes effect on the next request.
- Login attempts are limited by IP and email. Missing accounts, wrong passwords and missing grants use the same error.
- Write operations require the site's exact Origin and reject cross-site requests. Order list/detail reads require administrator authentication; member order reads still enforce ownership.
- Lists return at most 20 orders per page. Details read one order. Private responses use no-store; administrator pages forbid inline scripts, embedding and search indexing.
- Customer values are rendered only as text, including malformed legacy product data. There are no dynamic HTML strings or inline event handlers in the administrator UI.
- Only `paid → shipped → completed` is permitted through the status endpoint. Clients cannot set amounts, mark payments paid, cancel reservations, or ship a simulated payment. Verified payment workflows remain responsible for payment/stock transitions. Bank reconciliation and refunds are separate unfinished work.
- Status changes include an expected prior status and an audit record written in the same database batch. Stale or repeated changes fail with 409. Audit failure rolls back the change.

## Verification

Run `node --test *.test.mjs` and `wrangler deploy --dry-run`. `admin.test.mjs` covers public/member denial, page redirects, independent cookies, expiration, logout, password and grant revocation, throttling, pagination, CSRF, restricted transitions, stale updates and audit rollback. `runtime.test.mjs` also checks administrator sign-in against the Workers/D1 runtime.

Deployment and owner provisioning must be verified separately; local tests alone do not establish that the website is live.

## 首頁編輯
- 後台「首頁編輯」可上傳主照片／頁面背景照片、調整背景顏色、主照片裁切位置與遮罩，及各段首頁文字、字體、字級與顏色。
- 電腦與手機預覽使用實際首頁。修改在按下儲存前只存在瀏覽器，離開時提醒；可捨棄修改或預覽原始設定。
- 首次管理員儲存自動建立 homepage_settings（亦可執行 schema-homepage.sql），不改動訂單或會員資料；公開讀取未初始化設定時保留原首頁。
- 儲存要求獨立管理員登入、同來源與版本一致，並以同一交易寫入操作紀錄。圖片沿用本站受保護的上傳與媒體儲存。
- 測試：32 項自動測試（含 Workers/D1）通過；本機驗證文字、字級、手機預覽、照片上傳及重載後保留。
