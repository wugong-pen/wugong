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
 return {from:env.MAIL_FROM||'WUGONG <noreply@mail.wugong-pen.com>',to:[ADMIN_EMAIL],subject:(env.APP_ENV==='staging'?'【測試訂單】':'')+'WUGONG 新訂單 '+order.order_number,text:`新訂單已成立；此通知不代表買家已付款。\n\n訂單編號：${order.order_number}\n下單時間：${order.created_at}\n買家 Email：${order.email}\n收件國家：${order.country}\n\n${lines}\n\n訂單總額（含運費）：NT$${order.total}\n付款狀態：${order.payment==='paypal_invoice'?'待確認商品與運費，並由管理員另寄 PayPal 帳單':'待付款，請在後台核對'}\n\n查看訂單（須登入管理員）：\n${link}\n${env.APP_ENV==='staging'?'\n目前網站尚未開放正式收款，請勿依此測試通知收款或出貨。':''}`};
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
   if(id.startsWith('buyer-care/')){const current=await env.DB.prepare('SELECT status FROM orders WHERE order_number=?').bind(id.slice('buyer-care/'.length)).first();if(!current||!['shipped','completed'].includes(current.status)){await env.DB.prepare("UPDATE order_notifications SET state='cancelled',lease_until=0,last_error='訂單已不適用出貨關懷，停止寄送' WHERE id=? AND claim=?").bind(id,claim).run();continue;}}
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
 const rows=await env.DB.prepare('SELECT id,order_number,state,attempts,next_attempt,last_error,created_at,sent_at FROM order_notifications WHERE (? IS NULL OR order_number=? OR id=? OR id=? OR id=?) ORDER BY created_at DESC LIMIT 10').bind(number||null,number||null,'buyer-confirmed/'+number,'buyer-shipped/'+number,'buyer-care/'+number).all();
 return {recipient:ADMIN_EMAIL,configured:notificationConfigured(env),notifications:rows.results.map(r=>({...r,order_number:r.order_number||(r.id.startsWith('buyer-')?r.id.split('/')[1]:null),kind:r.id.startsWith('buyer-care/')?'buyer_care':r.id.startsWith('buyer-shipped/')?'buyer_shipped':r.id.startsWith('buyer-confirmed/')?'buyer_confirmed':'admin'}))};
}
export async function queueTestNotification(env){
 await notificationSchema(env);const id='notification-test/'+crypto.randomUUID();
 const payload={from:env.MAIL_FROM||'WUGONG <noreply@mail.wugong-pen.com>',to:[ADMIN_EMAIL],subject:'【寄信測試】WUGONG 管理員新訂單通知',text:'這是一封管理員通知測試信，不是買家訂單，無需收款或出貨。\n之後買家成功下單，您會在此信箱收到訂單摘要及後台連結。'};
 await env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) VALUES (?,?,?)').bind(id,JSON.stringify(payload),new Date().toISOString()).run();
 return id;
}

// Buyer event IDs are unique; NULL preserves the legacy unique admin order key.
export function buyerNotificationPayload(env,order,event,shipping={}) {
 const shipped=event==='shipped',test=env.APP_ENV==='staging';
 const items=typeof order.items==='string'?JSON.parse(order.items):order.items;
 const lines=items.map(i=>`${i.product}${i.nib?' / '+i.nib:''} × ${i.quantity}`).join('\n');
 const payment=order.payment==='paypal_invoice'
  ?'請等待我們確認商品與運費，再由專人另寄 PayPal 帳單至您的 Email。收到帳單前無需付款；本信不是付款帳單。\nPlease wait while we confirm your items and shipping. We will email a separate PayPal invoice. No payment is required before you receive it; this email is not an invoice.'
  :'下單不代表付款完成，請依結帳頁或會員購買紀錄確認付款狀態。\nPlacing an order does not confirm payment. Please check the checkout page or your purchase history for payment status.';
 const shippingText=`${shipping.factory_date?'出廠日期 / Factory date: '+shipping.factory_date+'\n保固期間：自出廠日期起一年，請妥善保留隨貨保固卡。\nWarranty: One year from the factory date. Please retain the warranty card included with your product.\n\n':''}物流公司 / Carrier: ${shipping.carrier||'請回覆本信洽詢 / Reply to this email for details'}\n物流單號 / Tracking number: ${shipping.tracking||'尚未提供，請回覆本信洽詢 / Not yet available; reply to this email for details'}\n物流追蹤資訊可能稍後才會更新。\nTracking information may take time to appear.`;
 return {from:env.MAIL_FROM||'WUGONG <noreply@mail.wugong-pen.com>',to:[order.email],reply_to:ADMIN_EMAIL,
 subject:(test?'【測試 / TEST】':'')+'WUGONG '+(shipped?'出貨通知 / Shipping notification ':'下單確認 / Order confirmation ')+order.order_number,
 text:`${test?'【測試通知】網站尚未開放正式收款；請勿付款。本信不代表實際出貨。\nTEST NOTICE: Live payments are unavailable. Do not pay. This email does not confirm a real shipment.\n\n':''}${shipped?'您的訂單已標記為出貨。\nYour order has been marked as shipped.':'我們已收到您的訂單，謝謝您的選購。\nThank you. We have received your order.'}\n\n訂單編號 / Order number: ${order.order_number}\n\n${lines}\n\n訂單總額（含運費）/ Total including shipping: NT$${order.total}\n\n${shipped?shippingText:payment}\n\n登入會員查看購買紀錄 / Sign in to view purchase history:\n${env.MAIL_ORIGIN||FALLBACK_ORIGIN}/member.html\n\n如有疑問，請回覆本信並提供訂單編號。\nFor assistance, reply with your order number.\n${ADMIN_EMAIL}`};
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
 subject:(env.APP_ENV==='staging'?'【測試 / TEST】':'')+'WUGONG 書寫使用關懷 / How is your pen writing? '+order.order_number,
 text:`${env.APP_ENV==='staging'?'【測試通知】這是網站測試流程產生的關懷信，不代表實際出貨。\nTEST NOTICE: This follow-up was generated by a website test and does not confirm a real shipment.\n\n':''}您好，謝謝您選擇 WUGONG。\n您的訂單 ${order.order_number} 已於幾天前安排出貨，想關心您收到並使用後的書寫感受。\n\n筆尖書寫時是否有刮紙、出墨不順、斷墨，或其他需要協助的地方？若有任何疑問，歡迎直接回覆這封信，告訴我們使用的墨水、紙張及遇到的情況；方便的話，也可以附上照片或短影片。\n\n我們會先與您詳聊，了解書寫狀況，並視需要安排寄回檢查與調整。請先與我們聯繫，再安排寄送。商品享有自保固卡出廠日期起一年的保固，適用範圍請參考購物須知。\n\n若您尚未收到商品，或還沒開始使用，無須急著回覆；待收到並試寫後，隨時歡迎與我們聯絡。\n\nHello, and thank you for choosing WUGONG.\nYour order ${order.order_number} was marked as shipped a few days ago. We would love to know how it writes once you have received and tried it.\n\nDoes the nib feel scratchy, have inconsistent ink flow, skip, or need any other attention? Please reply and tell us about the ink, paper and writing conditions. Photos or a short video are welcome if convenient.\n\nWe will discuss the issue with you and arrange a return for inspection and adjustment if needed. Please contact us before sending your pen. Your product has a one-year warranty from the factory date on its warranty card; see our Shopping Guide for coverage.\n\nIf your parcel has not arrived or you have not tried the pen yet, there is no rush to reply. You are welcome to contact us whenever you have had a chance to write with it.\n\n購物須知 / Shopping Guide:\n${env.MAIL_ORIGIN||FALLBACK_ORIGIN}/shopping-guide#returns\n\nWUGONG 吾鋼\n${ADMIN_EMAIL}`};
}
export function careNotificationStatements(env,order,auditId){
 const items=typeof order.items==='string'?JSON.parse(order.items):order.items;
 if(!items.some(i=>i.category==='pen'||(!i.category&&i.nib)))return [];
 const stamp=Date.now();
 return [env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at,next_attempt) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM admin_audit WHERE id=?)').bind('buyer-care/'+order.order_number,JSON.stringify(careNotificationPayload(env,order)),new Date(stamp).toISOString(),stamp+CARE_DELAY_MS,auditId)];
}
