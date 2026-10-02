import {notificationSchema,buyerNotificationPayload,ADMIN_EMAIL} from './order-notifications.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const liveEnabled=env=>env.PAYMENTS_LIVE==='true';
export async function liveSchema(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS live_orders(order_number TEXT PRIMARY KEY,created_at TEXT NOT NULL)").run();
 await notificationSchema(env);
}
export async function requireLiveOrder(env,order){
 if(!liveEnabled(env))fail(503,'正式付款尚未啟用');
 await liveSchema(env);
 if(!await env.DB.prepare('SELECT order_number FROM live_orders WHERE order_number=?').bind(order.order_number).first())fail(409,'此為開放正式收款前的訂單，請重新下單，勿付款');
}
export function paidEmailStatement(env,order,condition,bindings=[]){
 const payload=buyerNotificationPayload(env,order,'confirmed');
 payload.subject='WUGONG 已收到款項 / Payment received '+order.order_number;
 payload.text=`我們已確認收到您的款項，感謝您的購買。商品寄出後，我們會再寄送出貨通知。\nWe have confirmed your payment. Thank you for your purchase. We will email you again when your order ships.\n\n訂單編號 / Order number: ${order.order_number}\n付款金額 / Amount paid: NT$${order.total}\n\n查看訂單 / View your order:\n${env.MAIL_ORIGIN}/member.html\n\n${ADMIN_EMAIL}`;
 return env.DB.prepare('INSERT OR IGNORE INTO order_notifications(id,payload,created_at) SELECT ?,?,? WHERE '+condition).bind('buyer-paid/'+order.order_number,JSON.stringify(payload),new Date().toISOString(),...bindings);
}
export async function reportBank(env,order,data){
 await requireLiveOrder(env,order);
 if(order.payment!=='bank'||order.status!=='pending')fail(409,'此訂單無法回報匯款');
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),day=data.date;
 if(!/^\d{5}$/.test(data.last5||'')||!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day||day>today||day<new Date(Date.parse(order.created_at)+8*3600000).toISOString().slice(0,10))fail(400,'請填寫有效匯款日期及帳號末五碼');
 const stamp=new Date().toISOString();
 const payload={from:env.MAIL_FROM,to:[ADMIN_EMAIL],reply_to:order.email,subject:'WUGONG 買家已回報匯款 '+order.order_number,text:`買家已回報匯款，請核對銀行實際入帳。此回報不代表已收款，請勿僅依回報出貨。\n\n訂單：${order.order_number}\n買家 Email：${order.email}\n訂單金額：NT$${order.total}\n匯款日期：${day}\n匯款帳號末五碼：${data.last5}\n\n${env.MAIL_ORIGIN}/admin-order-detail.html?order=${encodeURIComponent(order.order_number)}`};
 // Repeated identical reports share an event ID. A correction creates a new notification.
 const id='bank-report/'+order.order_number+'/'+day+'/'+data.last5;
 const result=await env.DB.batch([
  env.DB.prepare("UPDATE payment_attempts SET remittance_last5=?,remittance_date=?,reported_at=? WHERE order_number=? AND provider='bank' AND (reported_at IS NOT NULL OR due_at>?) AND EXISTS(SELECT 1 FROM orders o JOIN checkout_reservations r ON r.order_number=o.order_number WHERE o.order_number=payment_attempts.order_number AND o.status='pending' AND r.state='paying')").bind(data.last5,day,stamp,order.order_number,stamp),
  env.DB.prepare('INSERT OR IGNORE INTO order_notifications(id,payload,created_at) SELECT ?,?,? WHERE changes()>0').bind(id,JSON.stringify(payload),stamp)
 ]);
 if(!result[0].meta.changes)fail(409,'訂單已變更或匯款期限已過，請聯絡客服確認');
}
export async function confirmBank(env,admin,data){
 const order=await env.DB.prepare('SELECT * FROM orders WHERE order_number=?').bind(typeof data.orderNumber==='string'?data.orderNumber:'').first();
 if(!order||order.payment!=='bank'||order.status!=='pending')fail(409,'訂單已變更，請重新整理');
 await requireLiveOrder(env,order);
 if(data.confirmed!==true||data.amount!==order.total||typeof data.reference!=='string'||!data.reference.trim()||data.reference.length>100)fail(400,'請核對實際入帳金額並填寫銀行入帳紀錄編號');
 const id=crypto.randomUUID(),stamp=new Date().toISOString(),owns='EXISTS(SELECT 1 FROM admin_audit WHERE id=?)';
 const result=await env.DB.batch([
  env.DB.prepare("INSERT INTO admin_audit(id,member_id,action,order_number,previous_status,next_status,created_at) SELECT ?,?,'bank.paid',?,'pending','paid',? WHERE EXISTS(SELECT 1 FROM orders o JOIN checkout_reservations r ON r.order_number=o.order_number WHERE o.order_number=? AND o.payment='bank' AND o.status='pending' AND r.state='paying') AND NOT EXISTS(SELECT 1 FROM payment_receipts WHERE order_number=?)").bind(id,admin.id,order.order_number,stamp,order.order_number,order.order_number),
  env.DB.prepare("INSERT INTO payment_receipts(order_number,provider,transaction_id,amount,currency,verified_at) SELECT ?,'bank',?,?,'TWD',? WHERE "+owns).bind(order.order_number,data.reference.trim(),order.total,stamp,id),
  env.DB.prepare('UPDATE inventory SET sold=sold+COALESCE((SELECT quantity FROM checkout_lines WHERE sku=inventory.sku AND order_number=?),0) WHERE '+owns).bind(order.order_number,id),
  env.DB.prepare("UPDATE checkout_reservations SET state='sold' WHERE order_number=? AND "+owns).bind(order.order_number,id),
  env.DB.prepare("UPDATE orders SET status='paid' WHERE order_number=? AND "+owns).bind(order.order_number,id),
  paidEmailStatement(env,order,owns,[id])
 ]);
 if(!result[0].meta.changes)fail(409,'訂單已變更，未重複確認或寄信');
}
