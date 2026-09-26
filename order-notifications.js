export const ADMIN_EMAIL='wugong.pen@gmail.com';
const FALLBACK_ORIGIN='https://wugong-test.wugong-pen.workers.dev';
export function notificationConfigured(env){try{return !!(env.RESEND_API_KEY&&env.MAIL_FROM&&new URL(env.MAIL_ORIGIN).protocol==='https:');}catch{return false;}}
export async function notificationSchema(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS order_notifications(id TEXT PRIMARY KEY,order_number TEXT UNIQUE,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,first_attempt INTEGER, next_attempt INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,claim TEXT,provider_id TEXT,last_error TEXT,created_at TEXT NOT NULL,sent_at TEXT)`).run();
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
 const rows=await env.DB.prepare('SELECT order_number,state,attempts,last_error,created_at,sent_at FROM order_notifications WHERE (? IS NULL OR order_number=?) ORDER BY created_at DESC LIMIT 10').bind(number||null,number||null).all();
 return {recipient:ADMIN_EMAIL,configured:notificationConfigured(env),notifications:rows.results};
}
export async function queueTestNotification(env){
 await notificationSchema(env);const id='notification-test/'+crypto.randomUUID();
 const payload={from:env.MAIL_FROM||'WUGONG <noreply@mail.wugong-pen.com>',to:[ADMIN_EMAIL],subject:'【寄信測試】WUGONG 管理員新訂單通知',text:'這是一封管理員通知測試信，不是買家訂單，無需收款或出貨。\n之後買家成功下單，您會在此信箱收到訂單摘要及後台連結。'};
 await env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) VALUES (?,?,?)').bind(id,JSON.stringify(payload),new Date().toISOString()).run();
 return id;
}
