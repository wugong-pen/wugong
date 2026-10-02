import {liveEnabled,requireLiveOrder,paidEmailStatement} from './live-payments.js';
import {lockPayment} from './inventory.js';
import {drainNotifications} from './order-notifications.js';
// Legacy signature fixtures use public sandbox credentials from https://developers.ecpay.com.tw/2856/
import { createHash, timingSafeEqual } from 'node:crypto';
export const ENDPOINT='https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
const merchant='3002607', key='pwFHCqoQZGmho4w6', iv='EkRm7iFT261dpevs';
export function checkMac(params, hashKey=key, hashIV=iv) {
  const keys=Object.keys(params).filter(k=>k!=='CheckMacValue').sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:a.toLowerCase()>b.toLowerCase()?1:0);
  const raw=`HashKey=${hashKey}&${keys.map(k=>`${k}=${params[k]}`).join('&')}&HashIV=${hashIV}`;
  const encoded=encodeURIComponent(raw).replace(/%20/g,'+').replace(/%2D/gi,'-').replace(/%5F/gi,'_').replace(/%2E/gi,'.').replace(/%21/gi,'!').replace(/%2A/gi,'*').replace(/%28/gi,'(').replace(/%29/gi,')').replace(/'/g,'%27').toLowerCase();
  return createHash('sha256').update(encoded).digest('hex').toUpperCase();
}
const abort=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function sandbox(env){if(env.PAYMENTS_LIVE!=='true'&&env.APP_ENV!=='staging')abort(503,'正式付款尚未開放');}
export const LIVE_ENDPOINT='https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
export function liveCredentials(env){
 if(!liveEnabled(env)||!/^\d{7,10}$/.test(env.ECPAY_MERCHANT_ID||'')||['3002607','2000132','2000214'].includes(env.ECPAY_MERCHANT_ID)||!env.ECPAY_HASH_KEY||!env.ECPAY_HASH_IV||env.ECPAY_HASH_KEY===key)abort(503,'綠界正式收款尚未設定完成');
 return {merchant:env.ECPAY_MERCHANT_ID,key:env.ECPAY_HASH_KEY,iv:env.ECPAY_HASH_IV};
}
async function ecpaySchema(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS ecpay_attempts(order_number TEXT PRIMARY KEY,merchant_id TEXT NOT NULL,payment_type TEXT NOT NULL,fields TEXT NOT NULL,checked_at TEXT)').run();}
export async function paymentForm(order,env){
 const c=liveCredentials(env);await requireLiveOrder(env,order);await ecpaySchema(env);
 if(order.status!=='pending'||!['ecpay','ecpay_twqr'].includes(order.payment))abort(409,'請查看訂單付款狀態');
 if(order.payment==='ecpay_twqr'&&(order.total<6||order.total>49999))abort(400,'TWQR 單筆限 NT$6～49,999，請改用其他付款方式');
 if(order.payment==='ecpay_twqr'&&env.ECPAY_TWQR_ENABLED!=='true')abort(503,'歐付寶 TWQR 尚未開通');
 const origin=new URL(env.PAYMENT_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PAYMENT_ORIGIN)abort(503,'付款網址設定不完整');
 await lockPayment(env,order.order_number);
 const fields={MerchantID:c.merchant,MerchantTradeNo:order.order_number,MerchantTradeDate:new Date(Date.now()+8*3600000).toISOString().slice(0,19).replaceAll('-','/').replace('T',' '),PaymentType:'aio',TotalAmount:String(order.total),TradeDesc:'WUGONG order',ItemName:JSON.parse(order.items).map(i=>`${i.product} x ${i.quantity}`).join('#').slice(0,400),ReturnURL:origin.origin+'/api/payments/ecpay/notify',ClientBackURL:origin.origin+'/payment-return.html?order='+order.order_number+'&provider=ecpay',ChoosePayment:order.payment==='ecpay'?'Credit':'TWQR',EncryptType:'1'};
 await env.DB.prepare('INSERT OR IGNORE INTO ecpay_attempts(order_number,merchant_id,payment_type,fields) VALUES (?,?,?,?)').bind(order.order_number,c.merchant,fields.ChoosePayment,JSON.stringify(fields)).run();
 const saved=await env.DB.prepare('SELECT * FROM ecpay_attempts WHERE order_number=?').bind(order.order_number).first();
 if(saved.merchant_id!==c.merchant)abort(409,'收款商店已變更，請聯絡客服');
 const signed=JSON.parse(saved.fields);signed.CheckMacValue=checkMac(signed,c.key,c.iv);
 return {action:LIVE_ENDPOINT,fields:signed};
}
export function validLiveNotice(data,order,attempt,c,query=false){
 const mac=data.CheckMacValue;
 if(typeof mac!=='string'||!/^[A-Fa-f0-9]{64}$/.test(mac)||!timingSafeEqual(Buffer.from(mac.toUpperCase()),Buffer.from(checkMac(data,c.key,c.iv))))return false;
 return data.MerchantID===c.merchant&&attempt.merchant_id===c.merchant&&data.MerchantTradeNo===order.order_number&&(query?data.SimulatePaid===undefined||data.SimulatePaid==='0':data.SimulatePaid==='0')&&/^\d+$/.test(data.TradeAmt||'')&&Number(data.TradeAmt)===order.total&&/^\d{1,30}$/.test(data.TradeNo||'')&&(attempt.payment_type==='Credit'?data.PaymentType==='Credit_CreditCard':data.PaymentType==='TWQR_OPAY');
}
export async function queryEcpay(env,order,send=fetch){
 const c=liveCredentials(env);await requireLiveOrder(env,order);await ecpaySchema(env);
 const attempt=await env.DB.prepare('SELECT * FROM ecpay_attempts WHERE order_number=?').bind(order.order_number).first();if(!attempt)return false;
 const fields={MerchantID:c.merchant,MerchantTradeNo:order.order_number,TimeStamp:String(Math.floor(Date.now()/1000))};fields.CheckMacValue=checkMac(fields,c.key,c.iv);
 const response=await send('https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString(),signal:AbortSignal.timeout(12000)});
 if(!response.ok)abort(502,'付款結果尚待確認');
 const raw=await response.text();if(raw.length>20000)abort(502,'付款結果尚待確認');const params=new URLSearchParams(raw);if([...params.keys()].length!==new Set(params.keys()).size)abort(502,'付款結果尚待確認');
 const result=Object.fromEntries(params);
 if(!validLiveNotice(result,order,attempt,c,true))abort(502,'付款資料驗證失敗');
 if(result.TradeStatus==='1'){await settleEcpay(env,order,result.TradeNo);return true;}return false;
}
export async function reconcileEcpay(env){
 if(!liveEnabled(env)||!env.ECPAY_MERCHANT_ID)return;
 await ecpaySchema(env);
 const stamp=new Date().toISOString(),before=new Date(Date.now()-10*60000).toISOString();
 const rows=await env.DB.prepare("SELECT o.* FROM orders o JOIN ecpay_attempts a ON a.order_number=o.order_number WHERE o.status='pending' AND o.created_at<? AND (a.checked_at IS NULL OR a.checked_at<?) ORDER BY COALESCE(a.checked_at,'') LIMIT 5").bind(before,before).all();
 for(const order of rows.results){try{await queryEcpay(env,order);}catch{console.error('ECPay reconciliation pending',order.order_number);}await env.DB.prepare('UPDATE ecpay_attempts SET checked_at=? WHERE order_number=?').bind(stamp,order.order_number).run();}
}
async function settleEcpay(env,order,transaction){
 await requireLiveOrder(env,order);
 const owns='EXISTS(SELECT 1 FROM payment_receipts WHERE order_number=? AND provider=\'ecpay\' AND transaction_id=? AND amount=?)',args=[order.order_number,transaction,order.total];
 await env.DB.batch([
  env.DB.prepare("INSERT INTO payment_receipts(order_number,provider,transaction_id,amount,currency,verified_at) SELECT ?,'ecpay',?,?,'TWD',? WHERE EXISTS(SELECT 1 FROM orders o JOIN checkout_reservations r ON r.order_number=o.order_number WHERE o.order_number=? AND o.status='pending' AND r.state='paying') ON CONFLICT(order_number) DO NOTHING").bind(order.order_number,transaction,order.total,new Date().toISOString(),order.order_number),
  env.DB.prepare("UPDATE inventory SET sold=sold+COALESCE((SELECT quantity FROM checkout_lines WHERE sku=inventory.sku AND order_number=?),0) WHERE EXISTS(SELECT 1 FROM checkout_reservations WHERE order_number=? AND state='paying') AND "+owns).bind(order.order_number,order.order_number,...args),
  env.DB.prepare("UPDATE checkout_reservations SET state='sold' WHERE order_number=? AND state='paying' AND "+owns).bind(order.order_number,...args),
  env.DB.prepare("UPDATE orders SET status='paid' WHERE order_number=? AND status='pending' AND "+owns).bind(order.order_number,...args),
  paidEmailStatement(env,order,owns,args)
 ]);
 const receipt=await env.DB.prepare('SELECT * FROM payment_receipts WHERE order_number=?').bind(order.order_number).first();
 if(!receipt||receipt.provider!=='ecpay'||receipt.transaction_id!==transaction||receipt.amount!==order.total)abort(409,'付款需人工確認');
}
export async function notify(request,env){
 if(!liveEnabled(env))return new Response('0|Payment integration disabled',{status:503});
 try{
  if(request.method!=='POST')return new Response('0|POST required',{status:405});
  const raw=await request.text();if(raw.length>20000)abort(400,'Invalid notification');
  const params=new URLSearchParams(raw);if([...params.keys()].length!==new Set(params.keys()).size)abort(400,'Invalid notification');
  const data=Object.fromEntries(params),c=liveCredentials(env);await ecpaySchema(env);
  const order=await env.DB.prepare('SELECT * FROM orders WHERE order_number=?').bind(data.MerchantTradeNo||'').first(),attempt=await env.DB.prepare('SELECT * FROM ecpay_attempts WHERE order_number=?').bind(data.MerchantTradeNo||'').first();
  if(!order||!attempt||!validLiveNotice(data,order,attempt,c))abort(400,'Invalid notification');
  if(data.RtnCode==='1'){if(!await queryEcpay(env,order))abort(409,'Payment pending');await drainNotifications(env);}
  return new Response('1|OK');
 }catch{return new Response('0|Verification failed',{status:400});}
}
const catalog=new Map();
for(const [id,product,price] of [['egypt','神秘之境・永晝之塔',150000],['fuji','靈峰之心・富士山',120000],['huangshan','煙雲畫境・黃山',120000],['lushan','匡盧聖境・廬山',120000]])catalog.set(`product-${id}`,{product,variants:{'WUGONG 筆尖':price}});
for(const [prefix,product,variants] of [['pojun-','四面楚歌・破軍',{'單尖':25000,'偃月刀尖':25000,'雙層特殊尖':29500,'逆雙層特殊尖':29500}],['sihuang-brass-','四皇・繫世（黃銅款）',{'單尖':13500,'雙層特殊尖':18000,'逆雙層特殊尖':18000}]])for(const nib of Object.keys(variants))catalog.set(prefix+nib,{product,variants:{[nib]:variants[nib]}});
export function quote(items){
  if(!Array.isArray(items)||!items.length||items.length>50)abort(400,'請確認購物車商品');
  const quantities=new Map();
  const result=items.map(item=>{
    if(!item||typeof item!=='object')abort(400,'請確認購物車商品');
    const entry=catalog.get(item.id),price=entry&&Object.hasOwn(entry.variants,item.nib)?entry.variants[item.nib]:undefined;
    if(!price)abort(400,'商品或筆尖規格已變更，請重新加入購物車');
    if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99)abort(400,'請確認商品數量');
    const count=(quantities.get(item.id)||0)+item.quantity;quantities.set(item.id,count);if(count>99)abort(400,'單項商品數量不能超過 99');
    return{id:item.id,product:entry.product,nib:item.nib,price,quantity:item.quantity};
  });
  return {items:result,total:result.reduce((sum,i)=>sum+i.price*i.quantity,0),shippingFee:0,currency:'TWD'};
}
