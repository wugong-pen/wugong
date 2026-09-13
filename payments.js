import {lockPayment,settlePayment} from './inventory.js';
import {createHmac} from 'node:crypto';
import {sandbox} from './ecpay.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const origin='https://wugong-test.wugong-pen.workers.dev';
export function methods(env,country){
 const test=env.APP_ENV==='staging';
 return {ecpay:false,bank:test&&country==='TW'&&!!bankConfig(env),linepay:false,paypal:test&&['JP','KR','US','SG'].includes(country)&&!!(env.PAYPAL_SANDBOX_CLIENT_ID&&env.PAYPAL_SANDBOX_CLIENT_SECRET)};
}
export function bankConfig(env){
 try{const b=JSON.parse(env.BANK_TEST_CONFIG||'null');return b&&['bank','code','branch','holder','account'].every(k=>typeof b[k]==='string'&&b[k].trim())&&Number.isInteger(b.days)&&b.days>=1&&b.days<=30?b:null;}catch{return null;}
}
export function lineSignature(secret,path,body,nonce){return createHmac('sha256',secret).update(secret+path+body+nonce).digest('base64');}
export function parseLine(text){return JSON.parse(text.replace(/("transactionId"\s*:\s*)(\d+)/g,'$1"$2"'));}
async function line(env,path,data){
 const body=JSON.stringify(data),nonce=crypto.randomUUID(),secret=env.LINEPAY_SANDBOX_CHANNEL_SECRET;
 const r=await fetch('https://sandbox-api-pay.line.me'+path,{method:'POST',headers:{'Content-Type':'application/json','X-LINE-ChannelId':env.LINEPAY_SANDBOX_CHANNEL_ID,'X-LINE-Authorization-Nonce':nonce,'X-LINE-Authorization':lineSignature(secret,path,body,nonce)},body,signal:AbortSignal.timeout(45000)});
 const result=parseLine(await r.text());if(!r.ok||result.returnCode!=='0000')fail(502,'LINE Pay 尚未確認成功，請稍後從購買紀錄查詢');return result.info;
}
async function paypal(env,path,method='GET',data,key){
 const auth=await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+btoa(env.PAYPAL_SANDBOX_CLIENT_ID+':'+env.PAYPAL_SANDBOX_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(15000)});
 const token=await auth.json();if(!auth.ok||!token.access_token)fail(503,'PayPal 測試帳號尚未設定完成');
 const r=await fetch('https://api-m.sandbox.paypal.com'+path,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json',...(key?{'PayPal-Request-Id':key}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(45000)});
 if(!r.ok)fail(502,'PayPal 尚未確認成功，請稍後從購買紀錄查詢');return r.json();
}
export function validRedirect(provider,value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.port===''&&u.hostname===(provider==='linepay'?'sandbox-web-pay.line.me':'www.sandbox.paypal.com');}catch{return false;}
}
export async function start(order,env){
 sandbox(env);if(env.PAYMENT_ORIGIN!==origin)fail(503,'測試付款網址尚未設定');
 if(methods(env,order.shipping_country)[order.payment]!==true)fail(503,'此付款方式尚未設定或不適用收件國家');
 if(order.status!=='pending')fail(409,'請查看訂單付款狀態');
 await lockPayment(env,order.order_number);
 let p=await env.DB.prepare('SELECT * FROM payment_attempts WHERE order_number=?').bind(order.order_number).first();
 if(p){if(p.due_at&&p.due_at<=new Date().toISOString())fail(409,'匯款期限已過，請查看訂單狀態');if(p.redirect_url)return {redirect:p.redirect_url};if(p.bank_details)return {bank:JSON.parse(p.bank_details),dueAt:p.due_at};fail(409,'付款請求處理中或結果待確認，請勿重複建立付款');}
 const state=crypto.randomUUID(),b=order.payment==='bank'?bankConfig(env):null;
 const due=b?new Date(Date.parse(order.created_at)+b.days*86400000).toISOString():null;
 const claimed=await env.DB.prepare('INSERT OR IGNORE INTO payment_attempts(order_number,provider,state,bank_details,due_at) VALUES (?,?,?,?,?)').bind(order.order_number,order.payment,state,b?JSON.stringify(b):null,due).run();
 if(!claimed.meta.changes)fail(409,'付款請求處理中，請稍後再試');
 if(b)return {bank:b,dueAt:due};
 const back=origin+'/payment-return.html?'+new URLSearchParams({order:order.order_number,provider:order.payment,state});
 let id,redirect;
 if(order.payment==='linepay'){
  const info=await line(env,'/v3/payments/request',{amount:order.total,currency:'TWD',orderId:order.order_number,packages:[{id:order.order_number,amount:order.total,products:JSON.parse(order.items).map(i=>({name:i.product+' '+i.nib,quantity:i.quantity,price:i.price}))}],options:{payment:{capture:true}},redirectUrls:{confirmUrl:back,cancelUrl:back+'&cancel=1'}});
  id=info.transactionId;redirect=info.paymentUrl?.web;
 }else{
  const result=await paypal(env,'/v2/checkout/orders','POST',{intent:'CAPTURE',purchase_units:[{reference_id:order.order_number,custom_id:order.order_number,amount:{currency_code:'TWD',value:String(order.total)}}],payment_source:{paypal:{experience_context:{return_url:back,cancel_url:back+'&cancel=1',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW'}}}},order.order_number+'-create');
  id=result.id;redirect=result.links?.find(l=>['payer-action','approve'].includes(l.rel))?.href;
 }
 if(typeof id!=='string'||!/^[a-zA-Z0-9]+$/.test(id)||!validRedirect(order.payment,redirect))fail(502,'付款平台回覆不完整，請查看訂單狀態');
 await env.DB.prepare('UPDATE payment_attempts SET provider_id=?,redirect_url=? WHERE order_number=?').bind(id,redirect,order.order_number).run();return {redirect};
}
export function paypalPaid(result,order,id){
 const units=result.purchase_units,unit=units?.[0],captures=unit?.payments?.captures,capture=captures?.[0];
 const customIds=[unit?.custom_id,capture?.custom_id].filter(value=>value!==undefined);
 return result.id===id&&result.status==='COMPLETED'&&units?.length===1&&unit.reference_id===order.order_number&&customIds.length>0&&customIds.every(value=>value===order.order_number)&&captures?.length===1&&typeof capture.id==='string'&&/^[a-zA-Z0-9]+$/.test(capture.id)&&capture.status==='COMPLETED'&&capture.amount?.currency_code==='TWD'&&typeof capture.amount.value==='string'&&/^[0-9]+(?:\.0{1,2})?$/.test(capture.amount.value)&&Number(capture.amount.value)===order.total&&capture.final_capture===true;
}
export function paypalApproved(result,order,id){
 const unit=result.purchase_units?.[0],amount=unit?.amount;
 return result.id===id&&result.intent==='CAPTURE'&&result.status==='APPROVED'&&result.purchase_units?.length===1&&unit.reference_id===order.order_number&&unit.custom_id===order.order_number&&amount?.currency_code==='TWD'&&typeof amount.value==='string'&&/^[0-9]+(?:\.0{1,2})?$/.test(amount.value)&&Number(amount.value)===order.total;
}
export async function confirm(order,env,data){
 sandbox(env);
 if(order.payment!=='paypal')fail(503,'此付款方式目前暫停');
 const p=await env.DB.prepare('SELECT * FROM payment_attempts WHERE order_number=?').bind(order.order_number).first();
 if(!p||p.state!==data.state||p.provider!==order.payment||!p.provider_id||!['linepay','paypal'].includes(order.payment))fail(400,'付款驗證資料不符');
 if(order.status==='test_paid')return;
 if(order.status!=='pending')fail(409,'請查看訂單狀態');
 await lockPayment(env,order.order_number);
 let transactionId;
 if(order.payment==='linepay'){
  if(data.transactionId!==p.provider_id)fail(400,'付款交易編號不符');
  const info=await line(env,`/v3/payments/${p.provider_id}/confirm`,{amount:order.total,currency:'TWD'});
  if(info.orderId!==order.order_number||info.transactionId!==p.provider_id||!Array.isArray(info.payInfo)||info.payInfo.reduce((s,i)=>s+i.amount,0)!==order.total)fail(502,'付款金額或訂單驗證失敗');
 }else{
  if(data.token!==p.provider_id)fail(400,'付款交易編號不符');
  let result=await paypal(env,'/v2/checkout/orders/'+p.provider_id);
  if(result.status==='APPROVED'){
   if(!paypalApproved(result,order,p.provider_id))fail(409,'PayPal 訂單或金額不符，未進行扣款');
   result=await paypal(env,`/v2/checkout/orders/${p.provider_id}/capture`,'POST',{},order.order_number+'-capture');
  }
  if(!paypalPaid(result,order,p.provider_id))fail(409,'PayPal 款項尚未確認完成，請稍後再查詢');
  transactionId=result.purchase_units[0].payments.captures[0].id;
 }
 await settlePayment(env,order,order.payment,order.payment==='paypal'?transactionId:p.provider_id);
}

export async function reconcilePayments(env){
 if(env.APP_ENV!=='staging'||!env.PAYPAL_SANDBOX_CLIENT_ID||!env.PAYPAL_SANDBOX_CLIENT_SECRET)return;
 const rows=await env.DB.prepare("SELECT o.*,p.provider_id FROM orders o JOIN payment_attempts p ON p.order_number=o.order_number JOIN checkout_reservations r ON r.order_number=o.order_number WHERE o.status='pending' AND p.provider='paypal' AND p.provider_id IS NOT NULL AND r.state='paying' ORDER BY COALESCE((SELECT checked_at FROM payment_checks WHERE order_number=o.order_number),'') LIMIT 10").all();
 for(const order of rows.results){
  try{
   const result=await paypal(env,'/v2/checkout/orders/'+order.provider_id);
   if(paypalPaid(result,order,order.provider_id))await settlePayment(env,order,'paypal',result.purchase_units[0].payments.captures[0].id);
  }catch{console.error('PayPal reconciliation pending',order.order_number);}
  await env.DB.prepare('INSERT INTO payment_checks(checked_at,order_number) VALUES (?,?) ON CONFLICT(order_number) DO UPDATE SET checked_at=excluded.checked_at').bind(new Date().toISOString(),order.order_number).run();
 }
}
