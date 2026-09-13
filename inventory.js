const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export async function expireReservations(env){
 const stamp=new Date().toISOString();
 const eligible="expires_at<=? AND (state='held' OR (state='paying' AND EXISTS(SELECT 1 FROM orders o WHERE o.order_number=checkout_reservations.order_number AND o.payment='bank') AND NOT EXISTS(SELECT 1 FROM payment_attempts p WHERE p.order_number=checkout_reservations.order_number AND p.reported_at IS NOT NULL)))";
 // Once online payment starts, an uncertain provider result must retain stock.
 await env.DB.batch([
  env.DB.prepare(`UPDATE inventory SET available=available+COALESCE((SELECT SUM(quantity) FROM checkout_lines WHERE sku=inventory.sku AND order_number IN (SELECT order_number FROM checkout_reservations WHERE ${eligible})),0)`).bind(stamp),
  env.DB.prepare(`UPDATE checkout_reservations SET state='released' WHERE ${eligible}`).bind(stamp),
  env.DB.prepare("UPDATE orders SET status='expired' WHERE status='pending' AND EXISTS(SELECT 1 FROM checkout_reservations r WHERE r.order_number=orders.order_number AND r.state='released')")
 ]);
}
export async function checkStock(env,items){
 const counts=new Map();for(const i of items)counts.set(i.id,(counts.get(i.id)||0)+i.quantity);
 for(const [sku,count] of counts){const row=await env.DB.prepare('SELECT available FROM inventory WHERE sku=?').bind(sku).first();if(!row||row.available<count)fail(409,'商品庫存不足，請調整數量後再試');}
}
export function reserveStatements(env,number,items,payment){
 const counts=new Map();for(const i of items)counts.set(i.id,(counts.get(i.id)||0)+i.quantity);
 return [env.DB.prepare("INSERT INTO checkout_reservations(order_number,state,expires_at) VALUES (?,'held',?)").bind(number,new Date(Date.now()+(payment==='bank'?3*86400000:30*60000)).toISOString()),...Array.from(counts,([sku,count])=>[
  // A failed quantity CHECK rolls back every statement in the D1 transaction.
  env.DB.prepare('INSERT INTO checkout_lines(order_number,sku,quantity) VALUES (?,?,CASE WHEN (SELECT available FROM inventory WHERE sku=?)>=? THEN ? ELSE 0 END)').bind(number,sku,sku,count,count),
  env.DB.prepare('UPDATE inventory SET available=available-? WHERE sku=?').bind(count,sku)
 ]).flat()];
}
export async function lockPayment(env,number){
 await expireReservations(env);
 await env.DB.prepare("UPDATE checkout_reservations SET state='paying' WHERE order_number=? AND state='held' AND expires_at>?").bind(number,new Date().toISOString()).run();
 const row=await env.DB.prepare('SELECT state FROM checkout_reservations WHERE order_number=?').bind(number).first();
 if(!row||row.state!=='paying')fail(409,'訂單庫存保留已失效，請重新下單；舊訂單請聯絡客服確認');
}
export async function settlePayment(env,order,provider,transactionId){
 if(typeof transactionId!=='string'||!transactionId.trim())fail(409,'付款交易資料不完整');
 const owns="EXISTS(SELECT 1 FROM payment_receipts WHERE order_number=? AND provider=? AND transaction_id=? AND amount=?)";
 await env.DB.batch([
  env.DB.prepare("INSERT INTO payment_receipts(order_number,provider,transaction_id,amount,currency,verified_at) SELECT ?,?,?,?,'TWD',? WHERE EXISTS(SELECT 1 FROM checkout_reservations WHERE order_number=? AND state='paying') ON CONFLICT(order_number) DO NOTHING").bind(order.order_number,provider,transactionId,order.total,new Date().toISOString(),order.order_number),
  env.DB.prepare(`UPDATE inventory SET sold=sold+COALESCE((SELECT quantity FROM checkout_lines WHERE sku=inventory.sku AND order_number=?),0) WHERE EXISTS(SELECT 1 FROM checkout_reservations WHERE order_number=? AND state='paying') AND ${owns}`).bind(order.order_number,order.order_number,order.order_number,provider,transactionId,order.total),
  env.DB.prepare(`UPDATE checkout_reservations SET state='sold' WHERE order_number=? AND state='paying' AND ${owns}`).bind(order.order_number,order.order_number,provider,transactionId,order.total),
  env.DB.prepare(`UPDATE orders SET status='test_paid' WHERE order_number=? AND status='pending' AND ${owns}`).bind(order.order_number,order.order_number,provider,transactionId,order.total)
 ]);
 const receipt=await env.DB.prepare('SELECT * FROM payment_receipts WHERE order_number=?').bind(order.order_number).first();
 if(!receipt||receipt.provider!==provider||receipt.transaction_id!==transactionId||receipt.amount!==order.total)fail(409,'付款需人工確認，請聯絡客服');
}
