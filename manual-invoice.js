const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export async function invoiceSchema(env){
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS manual_invoices(order_number TEXT PRIMARY KEY, invoice_number TEXT NOT NULL UNIQUE, due_date TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)`).run();
}
export async function readInvoice(env,number){await invoiceSchema(env);return env.DB.prepare('SELECT * FROM manual_invoices WHERE order_number=?').bind(number).first();}
export async function manageInvoice(env,admin,data){
 await invoiceSchema(env);
 const number=data.orderNumber,order=await env.DB.prepare("SELECT * FROM orders WHERE order_number=? AND payment='paypal_invoice'").bind(typeof number==='string'?number:'').first();
 if(!order||order.status!=='pending')fail(409,'訂單不存在或已非待付款狀態');
 if(!Number.isSafeInteger(data.version)||data.version<0)fail(400,'請重新整理帳單資料');
 const previous=await readInvoice(env,number);if((previous?.version||0)!==data.version)fail(409,'帳單已變更，請重新整理');
 const id=crypto.randomUUID(),stamp=new Date().toISOString(),owns='EXISTS(SELECT 1 FROM admin_audit WHERE id=?)';
 const eligible="EXISTS(SELECT 1 FROM orders o JOIN checkout_reservations r ON r.order_number=o.order_number WHERE o.order_number=? AND o.payment='paypal_invoice' AND o.status='pending' AND r.state='held') AND COALESCE((SELECT version FROM manual_invoices WHERE order_number=?),0)=?";
 if(data.action==='sent'){
  const invoice=typeof data.invoiceNumber==='string'?data.invoiceNumber.trim():'';
  if(!/^[A-Za-z0-9-]{1,80}$/.test(invoice)||!/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate||'')||!Number.isFinite(Date.parse(data.dueDate))||new Date(data.dueDate).toISOString().slice(0,10)!==data.dueDate)fail(400,'請填寫有效帳單編號與付款期限');
  if(data.confirmed!==true)fail(400,'請確認已在 PayPal 寄送相同金額的帳單');
  const r=await env.DB.batch([
   env.DB.prepare('INSERT INTO admin_audit(id,member_id,action,order_number,previous_status,next_status,created_at) SELECT ?,?,?,?,?,?,? WHERE '+eligible).bind(id,admin.id,'invoice.sent',number,'pending','pending',stamp,number,number,data.version),
   env.DB.prepare('INSERT INTO manual_invoices(order_number,invoice_number,due_date,version) SELECT ?,?,?,1 WHERE '+owns+' ON CONFLICT(order_number) DO UPDATE SET invoice_number=excluded.invoice_number,due_date=excluded.due_date,version=manual_invoices.version+1').bind(number,invoice,data.dueDate,id)
  ]);if(!r[0].meta.changes)fail(409,'訂單已變更，請重新整理');return;
 }
 if(data.action!=='paid'||!previous)fail(400,'請先記錄已寄出的 PayPal 帳單');
 const transaction=typeof data.transactionId==='string'?data.transactionId.trim().toUpperCase():'';
 if(!/^[A-Z0-9-]{5,80}$/.test(transaction)||data.amount!==order.total||data.currency!=='TWD'||data.confirmed!==true)fail(400,'請核對 PayPal 已完成收款的交易編號、訂單總額與 TWD 幣別');
 // This release remains a rehearsal. Production settlement must be explicitly enabled in a later release.
 if(env.APP_ENV!=='staging')fail(503,'正式人工收款核對尚未開放');
 const r=await env.DB.batch([
  env.DB.prepare('INSERT INTO admin_audit(id,member_id,action,order_number,previous_status,next_status,created_at) SELECT ?,?,?,?,?,?,? WHERE '+eligible).bind(id,admin.id,'invoice.test-paid',number,'pending','test_paid',stamp,number,number,data.version),
  env.DB.prepare("INSERT INTO payment_receipts(order_number,provider,transaction_id,amount,currency,verified_at) SELECT ?,'paypal',?,?,'TWD',? WHERE "+owns).bind(number,transaction,order.total,stamp,id),
  env.DB.prepare('UPDATE inventory SET sold=sold+COALESCE((SELECT quantity FROM checkout_lines WHERE sku=inventory.sku AND order_number=?),0) WHERE '+owns).bind(number,id),
  env.DB.prepare("UPDATE checkout_reservations SET state='sold' WHERE order_number=? AND "+owns).bind(number,id),
  env.DB.prepare("UPDATE orders SET status='test_paid' WHERE order_number=? AND "+owns).bind(number,id)
 ]);if(!r[0].meta.changes)fail(409,'訂單已變更，請重新整理');
}
