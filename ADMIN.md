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

## 內容管理與嵌入影片
- 後台新增網誌圖文、獲獎紀錄、活動花絮、媒體採訪，可新增及編輯日期、摘要、封面、文字段落、內文照片和 YouTube 影片，並調整區塊順序。
- 草稿及封存不公開；選擇已發布並儲存後顯示在品牌紀事。首次授權儲存自動建立內容資料表，儲存有版本檢查與同交易操作紀錄。
- YouTube 可貼上影片網址或 iframe 嵌入碼，只解析合法影片代碼，不執行任意 HTML。首頁、文章和商品都使用頁面內播放器。
- 首頁可新增最多 10 組照片輪播／影片；每組最多 12 張照片、合計 36 張，可設定排序、自動輪播與停留秒數。照片保留比例、影片隨螢幕寬度縮放。
- 商品影片在「筆款庫存／影片」設定，可先預覽。已核對的庫存只改影片時，庫存增減填 0 並填寫原因；未核對的筆款仍須先核對實際庫存。
- 本機驗證照片上傳、圖文排序及發布、首頁連續儲存、輪播上一張／下一張與暫停、商品嵌入碼儲存，以及手機和電腦畫面。測試資料僅存在本機。
- 本次完整自動測試：35 項通過（含 Workers/D1）；本機 Worker 組建成功。

## 會員編號與保固
- 會員姓名可點入，顯示生日、聯絡資料、已綁定的訂單與商品明細。
- 管理員可手動填寫會員編號，以及每支筆的商品名稱、保固卡編號、保固起訖日期、關聯訂單與備註。現場／舊購買可不綁訂單，以備註記錄來源。
- 首次授權儲存建立 member_service 與 member_warranties；會員編號、卡號不可重複，版本檢查及操作紀錄與修改同交易，既有保固紀錄保留。沒有自動按信箱認領舊訂單。

### 手動會員與購買紀錄
- 會員管理的「＋ 手動新增會員」可新增現場、展售及舊網站客人；姓名必填，信箱、生日、國家、電話與地址可選填。
- 手動管理資料使用不可登入的內部識別信箱、無密碼及停用登入狀態，聯絡信箱獨立保存；不會寄信或自動連結網站帳號、訂單。
- 既有會員可編輯基本資料與手動購買紀錄，網站登入信箱維持原值。
- 購買紀錄包含日期、商品／規格、數量、選填新台幣總金額、來源及備註；補登不會收款或改變庫存。
- 建立後可填會員編號及多支筆的保固卡編號、起訖日期。購買紀錄與保固分別儲存，既有紀錄可編輯而不能移除。
- member_contacts 為新增且可重複建立的資料表；交易同時保存資料與操作紀錄，版本與更新時間防止覆蓋他人修改。

### 首購贈品優惠券
- 優惠券管理新增「＋ 新增／更改首購優惠券」，依台灣／海外分別設定券名、贈品說明與數量、墨水／其他類型及啟用狀態。預設台灣 wugong 墨水一瓶、海外藏娥筆記本一本。
- 會員首次購買鋼筆時，按實際收件國家自動套用；不須領券或輸入代碼。一般優惠券仍在結帳頁輸入代碼後套用，每筆訂單一張；可另享首購贈品。
- 首購資格跨地區及設定版本共用；既有未取消／未逾期網站訂單及首購保留紀錄會排除資格。取消／逾期釋放資格；交易內檢查避免並行重複領取。
- 首購設定與贈品紀錄使用新增資料表，保留訂單當時的贈品說明，不因後續修改而變更。海外設定禁止墨水；贈品目前人工備貨，不自動扣除贈品庫存。

### 管理員建立首購專用券（2026-09-22）
- 「＋ 新增首購專用券」可建立多個首購贈品代碼，修改名稱、贈品與數量、收件地區、贈品類型及啟用狀態。代碼建立後固定，不能與一般券重複。
- 結帳分為一般優惠券與首購券兩欄，可各套用一張。指定首購券取代自動首購禮，不會額外再送一份。
- 首購資格按會員所有有效網站訂單判斷，本次需含鋼筆；已有有效訂單者不可使用。首購資格跨代碼及地區共用，每會員及每支收件電話限一次；一般券維持每會員每代碼一次。
- 修改或停用再啟用不會清除兌換紀錄。未完成訂單保留資格，取消或逾期後釋放資格；已完成使用不會因活動修改恢復。
- 新增 first_purchase_codes 與 first_purchase_redemptions，兌換與訂單、首購資格及一般券使用共同交易保存。


### 首購資格與電話限制（2026-09-23）
- 每位會員、每支收件電話各限一次，跨首購券代碼與收件地區共用。訂單成立即保留，只有管理員將訂單標記「已完成」才記為已領取。付款成功及出貨仍顯示保留中。
- 後台訂單詳情顯示首購資格狀態；首購專用券分開顯示已領取及保留中數量。
- 電話依收件國家轉成國際格式，忽略空格、連字號、括號與全形數字；台灣 09…、+886 9… 視為同號。台灣、日本、韓國、美國、新加坡等常用地區支援本地格式；其他地區請填 +國碼。
- 電話限制是收件電話比對，沒有簡訊驗證；填寫另一支電話仍可能規避，不能宣稱已確認本人或完全防止多帳號。
- first_purchase_phones 保存訂單當時的電話；自動補入既有贈品訂單，不改寫既有訂單或商品庫存。已有資料缺少有效電話者仍由原會員紀錄限制。
- 訂單改為 cancelled、expired、payment_failed 時，交易內釋放會員與首購券保留，電話紀錄依訂單狀態釋放。即使保留付款憑證，取消狀態仍恢復首購資格；原贈品及付款歷史保留。
- 後台「取消未付款訂單」只處理尚未付款、未回報匯款的安全保留訂單，並記錄操作人與時間，釋放購買商品及优惠券。付款結果不明或已回報匯款者須先核對；此按鈕不處理退款或已付款訂單。
- 目前網站的模擬付款訂單可依序標記出貨、完成，用來驗證作業流程，並不啟用正式收款。
- 贈品與商品庫存完全獨立。結帳與首購券設定固定顯示：「如贈品送完，將以其他贈品替代。海外替代贈品不含墨水。」訂單亦保留此註記。
- 參考：[Shopify 優惠券使用限制](https://help.shopify.com/en/manual/discounts/managing-discounts) 使用會員信箱或電話辨識；本網站依擁有人決定採相同電話限一次。
