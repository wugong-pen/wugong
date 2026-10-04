export const ADMIN_EMAIL='wugong.pen@gmail.com';
const FALLBACK_ORIGIN='https://wugong-test.wugong-pen.workers.dev';
export function notificationConfigured(env){try{return !!(env.RESEND_API_KEY&&env.MAIL_FROM&&new URL(env.MAIL_ORIGIN).protocol==='https:');}catch{return false;}}
export async function notificationSchema(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS order_notifications(id TEXT PRIMARY KEY,order_number TEXT UNIQUE,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,first_attempt INTEGER, next_attempt INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,claim TEXT,provider_id TEXT,last_error TEXT,created_at TEXT NOT NULL,sent_at TEXT)`).run();
}
export async function factoryDateForOrder(env,number){
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS order_factory_dates(order_number TEXT PRIMARY KEY,factory_date TEXT NOT NULL)').run();
 return (await env.DB.prepare('SELECT factory_date FROM order_factory_dates WHERE order_number=?').bind(number).first())?.factory_date||'';
}
export function validateFactoryDate(value){
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value||value<'1900-01-01'||value>today)throw Object.assign(new Error('請填寫有效的出廠日期，且不得晚於今天'),{status:400});
 return value;
}
export function notificationPayload(env,order){
 const link=(env.MAIL_ORIGIN||FALLBACK_ORIGIN)+'/admin-order-detail.html?order='+encodeURIComponent(order.order_number);
 const lines=order.items.map(i=>`${i.product}${i.nib?' / '+i.nib:''} × ${i.quantity}`).join('\n');
 return {from:env.MAIL_FROM||'WUGONG <noreply@mail.wugong-pen.com>',to:[ADMIN_EMAIL],subject:(env.APP_ENV==='staging'&&env.PAYMENTS_LIVE!=='true'?'【測試訂單】':'')+'WUGONG 新訂單 '+order.order_number,text:`新訂單已成立；此通知不代表買家已付款。\n\n訂單編號：${order.order_number}\n下單時間：${order.created_at}\n買家 Email：${order.email}\n收件國家：${order.country}\n\n${lines}\n\n訂單總額（含運費）：NT$${order.total}\n配送方式：${order.shipping||''}\n收件地點：${order.address||''}\n付款方式：${({bank:'自行匯款',ecpay:'綠界信用卡',ecpay_twqr:'歐付寶 TWQR',paypal_invoice:'PayPal 人工帳單'})[order.payment]||order.payment}\n付款狀態：${order.payment==='paypal_invoice'?'待確認商品與運費，並由管理員另寄 PayPal 帳單':'待付款，請在後台核對'}\n\n查看訂單（須登入管理員）：\n${link}\n${env.APP_ENV==='staging'&&env.PAYMENTS_LIVE!=='true'?'\n目前網站尚未開放正式收款，請勿依此測試通知收款或出貨。':''}`};
}
export function notificationStatement(env,order){return env.DB.prepare('INSERT INTO order_notifications(id,order_number,payload,created_at) VALUES (?,?,?,?)').bind('new-order/'+order.order_number,order.order_number,JSON.stringify(notificationPayload(env,order)),order.created_at);}
export async function drainNotifications(env,send=fetch){
 await notificationSchema(env);if(!notificationConfigured(env))return;
 const now=Date.now();
 // Resend's deduplication lasts 24 hours. Stop uncertain retries before that boundary.
 await env.DB.prepare("UPDATE order_notifications SET state='attention',last_error='請核對寄信服務紀錄，避免重複寄送' WHERE state='queued' AND (attempts>=10 OR first_attempt<?)").bind(now-23*3600000).run();
 const rows=await env.DB.prepare("SELECT id FROM order_notifications WHERE state='queued' AND next_attempt<=? AND lease_until<=? ORDER BY created_at LIMIT 10").bind(now,now).all();
 for(const {id} of rows.results){
  const claim=crypto.randomUUID(),stamp=Date.now();
  const row=await env.DB.prepare("UPDATE order_notifications SET claim=?,lease_until=?,attempts=attempts+1,first_attempt=COALESCE(first_attempt,?) WHERE id=? AND state='queued' AND next_attempt<=? AND lease_until<=? RETURNING *").bind(claim,stamp+120000,stamp,id,stamp,stamp).first();if(!row)continue;
  try{
   if(/^buyer-(confirmed|shipped|care)\//.test(id)){const p=JSON.parse(row.payload);if(p.subject.startsWith('【測試 / TEST】')){if(row.attempts>1){await env.DB.prepare("UPDATE order_notifications SET state='attention',lease_until=0,last_error='舊版信件曾嘗試寄送，請人工核對結果' WHERE id=? AND claim=?").bind(id,claim).run();continue;}p.subject=p.subject.replace('【測試 / TEST】','');p.text=p.text.replace(/^【測試通知】[\s\S]*?\n\n/,'');row.payload=JSON.stringify(p);await env.DB.prepare('UPDATE order_notifications SET payload=? WHERE id=? AND claim=?').bind(row.payload,id,claim).run();}}
   if(id.startsWith('buyer-care/')){const current=await env.DB.prepare('SELECT status FROM orders WHERE order_number=?').bind(id.slice('buyer-care/'.length)).first();if(!current||!['shipped','completed'].includes(current.status)){await env.DB.prepare("UPDATE order_notifications SET state='cancelled',lease_until=0,last_error='訂單已不適用出貨關懷，停止寄送' WHERE id=? AND claim=?").bind(id,claim).run();continue;}}
   if(id.startsWith('buyer-newyear/')){const [,year,token]=id.split('/');if(!await newYearRecipient(env,token,Number(year))){await env.DB.prepare("UPDATE order_notifications SET state='cancelled',lease_until=0,last_error='已停止年度問候或已無符合條件的購買紀錄' WHERE id=? AND claim=?").bind(id,claim).run();continue;}}
   if(id.startsWith('newsletter/')){const [,campaign,member]=id.split('/');const allowed=await env.DB.prepare("SELECT m.id FROM newsletter_recipients r JOIN members m ON m.id=r.member_id JOIN newsletter_preferences p ON p.member_id=m.id JOIN member_email_verified v ON v.member_id=m.id WHERE r.campaign_id=? AND r.member_id=? AND m.active=1 AND p.enabled=1 AND lower(p.email)=lower(m.email) AND lower(r.email)=lower(m.email)").bind(campaign,member).first();if(!allowed){await env.DB.prepare("UPDATE order_notifications SET state='cancelled',lease_until=0,last_error='會員已退訂、停用或信箱已變更，停止寄送' WHERE id=? AND claim=?").bind(id,claim).run();continue;}}
   const response=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':row.id},body:row.payload,signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('寄信服務回應 '+response.status);
   const receipt=await response.json();if(typeof receipt.id!=='string'||!receipt.id)throw Error('寄信服務未回傳收件編號');
   await env.DB.prepare("UPDATE order_notifications SET state='sent',provider_id=?,sent_at=?,lease_until=0,last_error=NULL WHERE id=? AND claim=?").bind(receipt.id,new Date().toISOString(),id,claim).run();
  }catch(error){
   const safe=/^寄信服務/.test(error.message||'')?error.message:'寄送結果待確認，將自動重試';
   await env.DB.prepare("UPDATE order_notifications SET next_attempt=?,lease_until=0,last_error=? WHERE id=? AND claim=? AND state='queued'").bind(Date.now()+Math.min(3600000,300000*2**Math.min(row.attempts-1,4)),safe,id,claim).run();
  }
 }
}
export async function notificationStatus(env,number){
 await notificationSchema(env);
 const rows=await env.DB.prepare('SELECT id,order_number,state,attempts,next_attempt,last_error,created_at,sent_at FROM order_notifications WHERE (? IS NULL OR order_number=? OR id=? OR id=? OR id=? OR id=? OR id LIKE ?) ORDER BY created_at DESC LIMIT 10').bind(number||null,number||null,'buyer-confirmed/'+number,'buyer-shipped/'+number,'buyer-care/'+number,'buyer-paid/'+number,'bank-report/'+number+'/%').all();
 return {recipient:ADMIN_EMAIL,configured:notificationConfigured(env),notifications:rows.results.map(r=>({...r,order_number:r.order_number||(r.id.startsWith('newsletter')?'電子報':/^(buyer-preview|newyear-preview)\//.test(r.id)?'內容預覽':r.id.startsWith('buyer-newyear/')?r.id.split('/')[1]+' 新年問候':(r.id.startsWith('buyer-')||r.id.startsWith('bank-report/'))?r.id.split('/')[1]:null),kind:r.id.startsWith('bank-report/')?'bank_report':r.id.startsWith('buyer-paid/')?'buyer_paid':r.id.startsWith('newsletter')?'newsletter':r.id.startsWith('newyear-preview/')?'newyear_preview':r.id.startsWith('buyer-newyear/')?'buyer_newyear':r.id.startsWith('buyer-preview/')?'buyer_preview':r.id.startsWith('buyer-care/')?'buyer_care':r.id.startsWith('buyer-shipped/')?'buyer_shipped':r.id.startsWith('buyer-confirmed/')?'buyer_confirmed':'admin'}))};
}
export async function queueTestNotification(env){
 await notificationSchema(env);const id='notification-test/'+crypto.randomUUID();
 const payload={from:env.MAIL_FROM||'WUGONG <noreply@mail.wugong-pen.com>',to:[ADMIN_EMAIL],subject:'【寄信測試】WUGONG 管理員新訂單通知',text:'這是一封管理員通知測試信，不是買家訂單，無需收款或出貨。\n之後買家成功下單，您會在此信箱收到訂單摘要及後台連結。'};
 await env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) VALUES (?,?,?)').bind(id,JSON.stringify(payload),new Date().toISOString()).run();
 return id;
}

// Buyer event IDs are unique; NULL preserves the legacy unique admin order key.
export function buyerNotificationPayload(env,order,event,shipping={}) {
 const shipped=event==='shipped';
 const items=typeof order.items==='string'?JSON.parse(order.items):order.items;
 const lines=items.map(i=>`${i.product}${i.nib?' / '+i.nib:''} × ${i.quantity}`).join('\n');
 const bank=order.bank;
 const payment=order.payment==='bank'&&bank
  ?`付款方式：自行匯款 / Payment method: Bank transfer\n銀行 / Bank: ${bank.bank} (${bank.code})\n分行 / Branch: ${bank.branch}\n戶名 / Account holder: ${bank.holder}\n帳號 / Account number: ${bank.account}\n付款期限 / Deadline: ${order.dueAt?new Date(order.dueAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'請查看訂單'}（台灣時間 / Taiwan time）\n\n完成匯款後，請登入網站回報匯款日期與轉出帳號末五碼；我們核對入帳後會另寄收款確認信。匯款回報不代表已確認付款。\nAfter transferring, sign in and report the transfer date and the last five digits of your sending account. We will email you after verifying receipt. A transfer report is not payment confirmation.\n${env.MAIL_ORIGIN||FALLBACK_ORIGIN}/payment-return.html?order=${encodeURIComponent(order.order_number)}&provider=bank`
  :order.payment==='paypal_invoice'
  ?'請等待我們確認商品與運費，再由專人另寄 PayPal 帳單至您的 Email。收到帳單前無需付款；本信不是付款帳單。\nPlease wait while we confirm your items and shipping. We will email a separate PayPal invoice. No payment is required before you receive it; this email is not an invoice.'
  :'下單不代表付款完成，請依結帳頁或會員購買紀錄確認付款狀態。\nPlacing an order does not confirm payment. Please check the checkout page or your purchase history for payment status.';
 const shippingText=`${shipping.factory_date?'出廠日期 / Factory date: '+shipping.factory_date+'\n保固期間：自出廠日期起一年，請妥善保留隨貨保固卡。\nWarranty: One year from the factory date. Please retain the warranty card included with your product.\n\n':''}物流公司 / Carrier: ${shipping.carrier||'請回覆本信洽詢 / Reply to this email for details'}\n物流單號 / Tracking number: ${shipping.tracking||'尚未提供，請回覆本信洽詢 / Not yet available; reply to this email for details'}\n物流追蹤資訊可能稍後才會更新。\nTracking information may take time to appear.`;
 return {from:env.MAIL_FROM||'WUGONG <noreply@mail.wugong-pen.com>',to:[order.email],reply_to:ADMIN_EMAIL,
 subject:'WUGONG '+(shipped?'出貨通知 / Shipping notification ':'下單確認 / Order confirmation ')+order.order_number,
 text:`${shipped?'您的訂單已出貨。\nYour order has been shipped.':'我們已收到您的訂單，謝謝您的選購。\nThank you. We have received your order.'}\n\n訂單編號 / Order number: ${order.order_number}\n\n${lines}\n\n訂單總額（含運費）/ Total including shipping: NT$${order.total}\n\n${order.shipping?'配送方式 / Delivery: '+order.shipping+'\n收件地點 / Destination: '+(order.address||'')+'\n\n':''}${shipped?shippingText:payment}\n\n登入會員查看購買紀錄 / Sign in to view purchase history:\n${env.MAIL_ORIGIN||FALLBACK_ORIGIN}/member.html\n\n如有疑問，請回覆本信並提供訂單編號。\nFor assistance, reply with your order number.\n${ADMIN_EMAIL}`};
}
export function buyerNotificationStatement(env,order,event,auditId=null,shipping={}) {
 const id='buyer-'+event+'/'+order.order_number,payload=buyerNotificationPayload(env,order,event,shipping);
 const values=[id,JSON.stringify(payload),new Date().toISOString()];
 return auditId===null?env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) VALUES (?,?,?)').bind(...values):env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM admin_audit WHERE id=?)').bind(...values,auditId);
}
export async function shipmentNotification(env,number,auditId,factoryDate){
 validateFactoryDate(factoryDate);
 await factoryDateForOrder(env,number);
 const dateStatement=env.DB.prepare('INSERT INTO order_factory_dates(order_number,factory_date) SELECT ?,? WHERE EXISTS(SELECT 1 FROM admin_audit WHERE id=?) ON CONFLICT(order_number) DO UPDATE SET factory_date=excluded.factory_date').bind(number,factoryDate,auditId);
 const order=await env.DB.prepare('SELECT * FROM orders WHERE order_number=?').bind(number).first();
 if(!order?.email)return [dateStatement]; // Legacy orders may have no buyer email.
 let shipping={};try{shipping=await env.DB.prepare('SELECT carrier,tracking FROM order_management WHERE order_number=?').bind(number).first()||{};}catch(e){if(!String(e.message).includes('no such table: order_management'))throw e;}
 await notificationSchema(env);
 return [dateStatement,buyerNotificationStatement(env,order,'shipped',auditId,{...shipping,factory_date:factoryDate}),...careNotificationStatements(env,order,auditId)];
}

export const CARE_DELAY_MS=5*24*60*60*1000;
export function careNotificationPayload(env,order){
 return {from:env.MAIL_FROM||'WUGONG <noreply@mail.wugong-pen.com>',to:[order.email],reply_to:ADMIN_EMAIL,
 subject:'WUGONG 書寫使用關懷 / How is your pen writing? '+order.order_number,
 text:`您好，謝謝您選擇 WUGONG。\n您的訂單 ${order.order_number} 已於幾天前安排出貨，想關心您收到並使用後的書寫感受。\n\n筆尖書寫時是否有刮紙、出墨不順、斷墨，或其他需要協助的地方？若有任何疑問，歡迎直接回覆這封信，告訴我們使用的墨水、紙張及遇到的情況；方便的話，也可以附上照片或短影片。\n\n我們會先與您詳聊，了解書寫狀況，並視需要安排寄回檢查與調整。請先與我們聯繫，再安排寄送。商品享有自保固卡出廠日期起一年的保固，適用範圍請參考購物須知。\n\n若您尚未收到商品，或還沒開始使用，無須急著回覆；待收到並試寫後，隨時歡迎與我們聯絡。\n\nHello, and thank you for choosing WUGONG.\nYour order ${order.order_number} was shipped a few days ago. We would love to know how it writes once you have received and tried it.\n\nDoes the nib feel scratchy, have inconsistent ink flow, skip, or need any other attention? Please reply and tell us about the ink, paper and writing conditions. Photos or a short video are welcome if convenient.\n\nWe will discuss the issue with you and arrange a return for inspection and adjustment if needed. Please contact us before sending your pen. Your product has a one-year warranty from the factory date on its warranty card; see our Shopping Guide for coverage.\n\nIf your parcel has not arrived or you have not tried the pen yet, there is no rush to reply. You are welcome to contact us whenever you have had a chance to write with it.\n\n購物須知 / Shopping Guide:\n${env.MAIL_ORIGIN||FALLBACK_ORIGIN}/shopping-guide#returns\n\nWUGONG 吾鋼\n${ADMIN_EMAIL}`};
}
export function careNotificationStatements(env,order,auditId){
 const items=typeof order.items==='string'?JSON.parse(order.items):order.items;
 if(!items.some(i=>i.category==='pen'||(!i.category&&i.nib)))return [];
 const stamp=Date.now();
 return [env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at,next_attempt) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM admin_audit WHERE id=?)').bind('buyer-care/'+order.order_number,JSON.stringify(careNotificationPayload(env,order)),new Date(stamp).toISOString(),stamp+CARE_DELAY_MS,auditId)];
}

export function memberEmailPayload(env,email,purpose,link){
 const reset=purpose==='reset',title=reset?'重設 WUGONG 會員密碼 / Reset your password':'驗證 WUGONG 會員電子郵件 / Verify your email';
 return {from:env.MAIL_FROM,to:[email],reply_to:ADMIN_EMAIL,subject:title,text:`${title}\n\n請開啟以下連結完成操作：\nPlease open the following link to continue:\n${link}\n\n連結有效時間：${reset?'30 分鐘':'24 小時'}，只能使用一次。\nThis link expires in ${reset?'30 minutes':'24 hours'} and can be used once.\n\n若您未申請此操作，請忽略此信。請勿將連結轉寄給他人。\nIf you did not request this, please ignore this email. Do not share this link with anyone.\n\nWUGONG 吾鋼\n${ADMIN_EMAIL}`};
}
export function buyerEmailPreviews(env,email){
 const order={order_number:'WG-PREVIEW',email,items:[{product:'手工鋼筆 / Handcrafted fountain pen',nib:'單尖 / Single nib',quantity:1}],total:3000,payment:'bank'};
 return [buyerNotificationPayload(env,order,'confirmed'),buyerNotificationPayload(env,{...order,payment:'paypal_invoice'},'confirmed'),buyerNotificationPayload(env,order,'shipped',{factory_date:new Date(Date.now()+8*3600000).toISOString().slice(0,10),carrier:'物流公司 / Carrier',tracking:'物流單號 / Tracking number'}),careNotificationPayload(env,order),memberEmailPayload(env,email,'verify','（專屬驗證連結位置；此預覽不含有效連結 / Your secure link appears here; no active link in this preview）'),memberEmailPayload(env,email,'reset','（專屬重設連結位置；此預覽不含有效連結 / Your secure link appears here; no active link in this preview）')].map((p,i)=>({...p,subject:'【內容預覽 '+(i+1)+'/6】'+p.subject,text:'此信供確認通知內容，使用示例商品與金額，不是實際訂單、付款要求或出貨紀錄。\nContent preview with example items and amounts, not an actual order, payment request or shipment.\n\n'+p.text}));
}
export async function queueBuyerEmailPreviews(env,email,key,adminId){
 if(typeof email!=='string'||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw Object.assign(new Error('請確認預覽收件信箱與寄送編號'),{status:400});
 await notificationSchema(env);
 const prefix='buyer-preview/'+adminId+'/'+key+'/';
 const existing=await env.DB.prepare('SELECT payload FROM order_notifications WHERE id=?').bind(prefix+'0').first();
 if(existing){if(JSON.parse(existing.payload).to[0]!==email)throw Object.assign(new Error('此寄送編號已用於另一信箱，請重新整理'),{status:409});return;}
 await env.DB.batch(buyerEmailPreviews(env,email).map((p,i)=>env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(prefix+i,JSON.stringify(p),new Date().toISOString())));
}

// The existing five-minute cron checks Taipei's calendar; no browser or app must remain open.
export async function newYearSchema(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS annual_greeting_preferences(email TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)))").run();
}
const newYearBuyers=`SELECT DISTINCT lower(trim(m.email)) AS email FROM members m
 JOIN member_orders mo ON mo.member_id=m.id JOIN orders o ON o.order_number=mo.order_number
 WHERE m.active=1 AND o.status IN ('shipped','completed') AND o.created_at<?
 AND NOT EXISTS(SELECT 1 FROM admin_audit a WHERE a.order_number=o.order_number AND (a.previous_status='test_paid' OR a.next_status='test_paid'))`;
const yearCutoff=year=>`${year-1}-12-31T16:00:00.000Z`;
async function newYearRecipient(env,token,year){
 return env.DB.prepare(`SELECT p.email FROM annual_greeting_preferences p WHERE p.token=? AND p.enabled=1 AND p.email IN (${newYearBuyers})`).bind(token,yearCutoff(year)).first();
}
export function newYearPayload(env,email,year,token=''){
 const stop=token?`停止年度問候 / Unsubscribe from annual greetings:\n${env.MAIL_ORIGIN||FALLBACK_ORIGIN}/annual-greetings/unsubscribe?token=${encodeURIComponent(token)}`:'（正式信件會附上停止年度問候連結；此預覽不含有效連結。 / Actual messages include an unsubscribe link; this preview has no active link.）';
 return {from:env.MAIL_FROM||'WUGONG <noreply@mail.wugong-pen.com>',to:[email],reply_to:ADMIN_EMAIL,
 subject:`WUGONG｜${year} 新年快樂，願美好隨筆而至 / Happy New Year`,
 text:`親愛的朋友，新年快樂！\n\n謝謝您讓 WUGONG 的作品，陪伴您的書寫與生活。新的一年，願您與家人平安健康、心有所喜；願每一次落筆，都能記錄值得珍藏的時光，寫下屬於自己的美好篇章。\n\n也想關心，您的鋼筆最近使用得還順手嗎？筆尖是否有刮紙、出墨不順、斷墨，或其他想與我們聊聊的地方？無論是使用上的疑問，或是想分享一段書寫日常，都歡迎直接回覆這封信。\n\n若有需要協助的狀況，我們會先與您了解使用的墨水、紙張及書寫情形，再一起確認適合的處理方式；如需寄回檢查，請先與我們聯繫。\n\n祝福您在 ${year} 年，生活安好，靈感常在，所珍惜的人事物都能溫柔相伴。\n\nDear friend, Happy New Year!\n\nThank you for making WUGONG part of your writing and everyday life. May the year ahead bring you and your loved ones good health, peace and joy. May every page hold moments worth keeping and stories that are uniquely yours.\n\nHow has your fountain pen been writing lately? If the nib feels scratchy, the ink flow is uneven, or you notice any skipping, please reply and tell us. We are also always happy to hear about the moments you have enjoyed with your pen.\n\nIf you need help, we will discuss your ink, paper and writing conditions with you and work out the next step together. Please contact us before returning a pen for inspection.\n\nWishing you a peaceful, inspiring ${year}, filled with the people and things you cherish.\n\nWUGONG 吾鋼\n${ADMIN_EMAIL}\n\n${stop}\n停止年度問候不影響訂單、出貨及售後必要通知。\nUnsubscribing from annual greetings does not affect essential order, shipping or service notifications.`};
}
export async function queueNewYearGreetings(env,stamp=Date.now()){
 const local=new Date(stamp+8*3600000);
 if(local.getUTCMonth()!==0||local.getUTCDate()!==1||local.getUTCHours()<9||!notificationConfigured(env))return;
 const year=local.getUTCFullYear();
 await notificationSchema(env);await newYearSchema(env);
 // Small batches keep the scheduled worker bounded and resume safely on the next tick.
 const missing=await env.DB.prepare(`SELECT email FROM (${newYearBuyers}) b WHERE NOT EXISTS(SELECT 1 FROM annual_greeting_preferences p WHERE p.email=b.email) LIMIT 100`).bind(yearCutoff(year)).all();
 if(missing.results.length)await env.DB.batch(missing.results.map(({email})=>env.DB.prepare('INSERT INTO annual_greeting_preferences(email,token) VALUES (?,?) ON CONFLICT(email) DO NOTHING').bind(email,crypto.randomUUID().replaceAll('-',''))));
 const rows=await env.DB.prepare(`SELECT p.email,p.token FROM annual_greeting_preferences p WHERE p.enabled=1 AND p.email IN (${newYearBuyers}) AND NOT EXISTS(SELECT 1 FROM order_notifications n WHERE n.id=?||p.token) ORDER BY p.email LIMIT 100`).bind(yearCutoff(year),'buyer-newyear/'+year+'/').all();
 if(rows.results.length)await env.DB.batch(rows.results.map(({email,token})=>env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind('buyer-newyear/'+year+'/'+token,JSON.stringify(newYearPayload(env,email,year,token)),new Date(stamp).toISOString())));
}
export async function queueNewYearPreview(env,email,key,adminId){
 if(typeof email!=='string'||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key))throw Object.assign(new Error('請確認預覽收件信箱與寄送編號'),{status:400});
 await notificationSchema(env);const id='newyear-preview/'+adminId+'/'+key;
 const existing=await env.DB.prepare('SELECT payload FROM order_notifications WHERE id=?').bind(id).first();
 if(existing){if(JSON.parse(existing.payload).to[0]!==email)throw Object.assign(new Error('此寄送編號已用於另一信箱，請重新整理'),{status:409});return;}
 const local=new Date(Date.now()+8*3600000),year=local.getUTCFullYear()+(local.getUTCMonth()===0&&local.getUTCDate()===1?0:1);
 const p=newYearPayload(env,email,year);p.subject='【內容預覽】'+p.subject;
 await env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,JSON.stringify(p),new Date().toISOString()).run();
}
export async function annualUnsubscribe(request,env){
 const url=new URL(request.url),token=url.searchParams.get('token')||'';
 const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
 if(!/^[a-f0-9]{32}$/.test(token))return new Response('連結無效 / Invalid link',{status:400,headers});
 if(!['GET','POST'].includes(request.method))return new Response('Method not allowed',{status:405,headers});
 await newYearSchema(env);
 const row=await env.DB.prepare('SELECT enabled FROM annual_greeting_preferences WHERE token=?').bind(token).first();
 if(!row)return new Response('連結無效 / Invalid link',{status:404,headers});
 // GET is a confirmation page: email scanners cannot unsubscribe a buyer by opening a link.
 if(request.method==='POST'){
  if(request.headers.get('Origin')!==url.origin)return new Response('請由確認頁送出 / Please use the confirmation page',{status:403,headers});
  await env.DB.prepare('UPDATE annual_greeting_preferences SET enabled=0 WHERE token=?').bind(token).run();
 }
 const stopped=!row.enabled||request.method==='POST';
 return new Response(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WUGONG 年度問候 / Annual greetings</title><body style="max-width:640px;margin:64px auto;padding:24px;font:18px/1.8 sans-serif"><h1>WUGONG 吾鋼</h1><h2>${stopped?'已停止年度問候 / Unsubscribed':'停止年度問候 / Unsubscribe'}</h2><p>${stopped?'您將不再收到每年新年問候。 / You will no longer receive our annual New Year greeting.':'確定不再收到每年新年問候嗎？ / Would you like to stop receiving our annual New Year greeting?'}</p><p>訂單、出貨及售後必要通知不受影響。<br>Essential order, shipping and service notifications are unaffected.</p>${stopped?'':`<form method="post"><button type="submit" style="padding:12px">確認停止年度問候 / Confirm unsubscribe</button></form>`}</body></html>`,{headers});
}
