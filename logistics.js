import {createHash,timingSafeEqual} from 'node:crypto';
import {CVS_TYPES,storeSchema} from './shipping.js';
import {requireLiveOrder} from './live-payments.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const stamp=()=>new Date().toISOString();
const root='https://logistics.ecpay.com.tw';
export function logisticsMac(data,key,iv){
 const keys=Object.keys(data).filter(k=>k!=='CheckMacValue').sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:a.toLowerCase()>b.toLowerCase()?1:0);
 const raw=`HashKey=${key}&${keys.map(k=>`${k}=${data[k]}`).join('&')}&HashIV=${iv}`;
 return createHash('md5').update(encodeURIComponent(raw).replace(/%20/g,'+').replace(/'/g,'%27').toLowerCase()).digest('hex').toUpperCase();
}
function credentials(env){
 const merchant=env.ECPAY_MERCHANT_ID,key=env.ECPAY_LOGISTICS_HASH_KEY,iv=env.ECPAY_LOGISTICS_HASH_IV;
 if(env.PAYMENTS_LIVE!=='true'||!/^\d{7,10}$/.test(merchant||'')||['2000933','2000132','2000214','3002607'].includes(merchant)||!key||!iv)fail(503,'綠界正式物流金鑰尚未設定');
 return {merchant,key,iv};
}
export function validLogisticsName(name){const size=[...String(name||'')].reduce((n,c)=>n+(c.charCodeAt(0)>127?2:1),0);return typeof name==='string'&&/^[A-Za-z\u3400-\u9fff ]+$/.test(name)&&size>=4&&size<=10;}
export async function logisticsSchema(env){
 await storeSchema(env);
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS logistics_settings(id INTEGER PRIMARY KEY CHECK(id=1),sender_name TEXT NOT NULL,sender_phone TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS logistics_orders(order_number TEXT PRIMARY KEY,trade_no TEXT NOT NULL UNIQUE,merchant_id TEXT NOT NULL,subtype TEXT NOT NULL,goods_amount INTEGER NOT NULL,state TEXT NOT NULL,fields TEXT NOT NULL,logistics_id TEXT UNIQUE,payment_no TEXT,validation_no TEXT,status_code TEXT,status_message TEXT,status_date TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
}
async function settings(env){await logisticsSchema(env);return await env.DB.prepare('SELECT sender_name,sender_phone,version FROM logistics_settings WHERE id=1').first()||{sender_name:'',sender_phone:'',version:0};}
async function getOrder(env,number){if(typeof number!=='string'||number.length>60)fail(400,'請確認訂單編號');const o=await env.DB.prepare('SELECT o.*,m.shipping_country FROM orders o JOIN member_orders m ON m.order_number=o.order_number WHERE o.order_number=?').bind(number).first();if(!o)fail(404,'找不到訂單');return o;}
function publicRow(r){if(!r)return null;const {fields,...safe}=r;return safe;}
function audit(env,admin,action,number,detail){return env.DB.prepare('INSERT INTO commerce_audit VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.id,action,number,'{}',JSON.stringify(detail),'綠界超商純取貨',stamp());}
export async function logisticsDetail(env,number){
 await logisticsSchema(env);const order=await getOrder(env,number),store=await env.DB.prepare('SELECT subtype,store_id,store_name,address FROM cvs_selections WHERE used_order=?').bind(number).first();
 const row=await env.DB.prepare('SELECT * FROM logistics_orders WHERE order_number=?').bind(number).first();
 let ready=true;try{credentials(env);}catch{ready=false;}
 const fee=await env.DB.prepare('SELECT fee FROM order_shipping WHERE order_number=?').bind(number).first();
 return {store,logistics:publicRow(row),sender:await settings(env),credentialsReady:ready,goodsAmount:Number.isSafeInteger(fee?.fee)?order.total-fee.fee:null};
}
export function createFields(env,order,store,sender,amount,trade){
 const c=credentials(env);
 if(!Number.isSafeInteger(amount)||amount<1||amount>20000)fail(400,'商品金額須介於 NT$1～20,000；請改用其他配送安排，不可低報金額');
 if(!validLogisticsName(sender.sender_name)||!/^09\d{8}$/.test(sender.sender_phone||''))fail(400,'請先設定寄件人的真實姓名（中文 2～5 字／英文 4～10 字）及手機');
 if(!validLogisticsName(order.customer_name)||!/^09\d{8}$/.test(order.phone||''))fail(400,'收件姓名須為中文 2～5 字／英文 4～10 字，手機須為 09 開頭十碼；請先聯絡買家核對');
 if(!store||!Object.hasOwn(CVS_TYPES,store.subtype)||!/^\d{6}$/.test(store.store_id))fail(400,'缺少有效的超商地圖門市資料');
 const origin=new URL(env.PAYMENT_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PAYMENT_ORIGIN)fail(503,'物流回傳網址尚未設定');
 const date=new Date(Date.parse(order.created_at)+8*3600000).toISOString().slice(0,19).replaceAll('-','/').replace('T',' ');
 return {MerchantID:c.merchant,MerchantTradeNo:trade,MerchantTradeDate:date,LogisticsType:'CVS',LogisticsSubType:store.subtype,GoodsAmount:String(amount),IsCollection:'N',GoodsName:'WUGONG商品',SenderName:sender.sender_name,SenderCellPhone:sender.sender_phone,ReceiverName:order.customer_name,ReceiverCellPhone:order.phone,ReceiverStoreID:store.store_id,ServerReplyURL:origin.origin+'/logistics/notify'};
}
function parse(raw){if(raw.length>20000)fail(502,'綠界回傳資料異常');const p=new URLSearchParams(raw);for(const k of p.keys())if(p.getAll(k).length!==1)fail(502,'綠界回傳資料重複');return Object.fromEntries(p);}
function verified(d,c){return /^[a-f0-9]{32}$/i.test(d.CheckMacValue||'')&&timingSafeEqual(Buffer.from(d.CheckMacValue.toUpperCase()),Buffer.from(logisticsMac(d,c.key,c.iv)))&&d.MerchantID===c.merchant;}
async function saveResult(env,row,d,query=false){
 if(d.MerchantTradeNo!==row.trade_no||d.MerchantID!==row.merchant_id||!/^\d{1,20}$/.test(d.AllPayLogisticsID||'')||(row.logistics_id&&row.logistics_id!==d.AllPayLogisticsID)||Number(d.GoodsAmount)!==row.goods_amount||(query?d.LogisticsType!=='CVS_'+row.subtype:d.LogisticsType!=='CVS'||d.LogisticsSubType!==row.subtype))fail(502,'物流訂單資料核對不符');
 const code=query?d.LogisticsStatus:d.RtnCode;if(!/^\d{1,8}$/.test(code||''))fail(502,'物流狀態格式不符');
 if(d.CVSPaymentNo&&!/^\d{1,15}$/.test(d.CVSPaymentNo)||d.CVSValidationNo&&!/^\d{1,10}$/.test(d.CVSValidationNo))fail(502,'寄貨編號格式不符');
 // An older signed callback must not overwrite a newer status. Query responses lack a status timestamp.
 const date=d.UpdateStatusDate||'';if(date&&!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(date))fail(502,'物流日期格式不符');
 await env.DB.prepare("UPDATE logistics_orders SET state='created',logistics_id=?,payment_no=COALESCE(NULLIF(?,''),payment_no),validation_no=COALESCE(NULLIF(?,''),validation_no),status_code=CASE WHEN ?='' OR status_date IS NULL OR ?>=status_date THEN ? ELSE status_code END,status_message=CASE WHEN ?='' OR status_date IS NULL OR ?>=status_date THEN ? ELSE status_message END,status_date=CASE WHEN ?<>'' AND (status_date IS NULL OR ?>=status_date) THEN ? ELSE status_date END,error=NULL,updated_at=? WHERE order_number=? AND (logistics_id IS NULL OR logistics_id=?)").bind(d.AllPayLogisticsID,d.CVSPaymentNo||'',d.CVSValidationNo||'',date,date,code,date,date,(d.RtnMsg||'物流狀態 '+code).slice(0,200),date,date,date,stamp(),row.order_number,d.AllPayLogisticsID).run();
 const saved=await env.DB.prepare('SELECT payment_no,validation_no FROM logistics_orders WHERE order_number=?').bind(row.order_number).first();
 if(saved.payment_no&&(row.subtype!=='UNIMARTC2C'||saved.validation_no))await env.DB.prepare("INSERT INTO order_management(order_number,admin_note,carrier,tracking,updated_at) SELECT ?,'',?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE order_number=? AND status='paid') ON CONFLICT(order_number) DO UPDATE SET carrier=excluded.carrier,tracking=excluded.tracking,updated_at=excluded.updated_at,version=order_management.version+1 WHERE order_management.tracking='' AND EXISTS(SELECT 1 FROM orders WHERE order_number=order_management.order_number AND status='paid')").bind(row.order_number,CVS_TYPES[row.subtype]+'（綠界超商純取貨）',saved.payment_no+(saved.validation_no||''),stamp(),row.order_number).run();
}
async function sendForm(env,path,fields,send){const c=credentials(env),signed={...fields,CheckMacValue:logisticsMac(fields,c.key,c.iv)};const r=await send(root+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(signed).toString(),signal:AbortSignal.timeout(15000)});if(!r.ok)fail(502,'綠界連線結果未確認');return r.text();}
export async function createLogistics(env,admin,number,send=fetch){
 await logisticsSchema(env);const order=await getOrder(env,number);await requireLiveOrder(env,order);
 if(order.status!=='paid'||order.shipping_country!=='TW'||!['bank','ecpay'].includes(order.payment))fail(409,'僅限已確認收款、尚未出貨的台灣信用卡／匯款訂單');
 const receipt=await env.DB.prepare('SELECT amount,currency FROM payment_receipts WHERE order_number=?').bind(number).first();if(!receipt||receipt.amount!==order.total||receipt.currency!=='TWD')fail(409,'缺少已核對的收款紀錄');
 let row=await env.DB.prepare('SELECT * FROM logistics_orders WHERE order_number=?').bind(number).first();
 if(row){if(row.state==='created')return publicRow(row);fail(409,'此單已送出建立要求，請按「查詢／同步物流」核對結果，勿重複建立');}
 const detail=await logisticsDetail(env,number),trade='WL'+crypto.randomUUID().replaceAll('-','').slice(0,18),fields=createFields(env,order,detail.store,detail.sender,detail.goodsAmount,trade),time=stamp();
 const lock=await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO logistics_orders(order_number,trade_no,merchant_id,subtype,goods_amount,state,fields,created_at,updated_at) SELECT ?,?,?,?,?,'creating',?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE order_number=? AND status='paid') AND NOT EXISTS(SELECT 1 FROM order_management WHERE order_number=? AND tracking<>'')").bind(number,trade,fields.MerchantID,fields.LogisticsSubType,detail.goodsAmount,JSON.stringify(fields),time,time,number,number),
  env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),audit(env,admin,'logistics.create',number,{trade})
 ]);
 if(!lock[0].meta.changes)fail(409,'訂單已有物流資料或正由其他管理員處理');
 row=await env.DB.prepare('SELECT * FROM logistics_orders WHERE order_number=?').bind(number).first();
 try{const raw=await sendForm(env,'/Express/Create',fields,send);if(!raw.startsWith('1|'))fail(502,'綠界未確認建立成功，請查詢物流或至綠界後台核對（可能為餘額、資料或門市問題）');const d=parse(raw.slice(2));if(!verified(d,credentials(env)))fail(502,'物流回傳驗證失敗');await saveResult(env,row,d);}
 catch{await env.DB.prepare("UPDATE logistics_orders SET state='uncertain',error=?,updated_at=? WHERE order_number=? AND state='creating'").bind('建立結果待確認，請查詢／同步物流；請勿另建重複寄件單',stamp(),number).run();}
 return publicRow(await env.DB.prepare('SELECT * FROM logistics_orders WHERE order_number=?').bind(number).first());
}
export async function queryLogistics(env,number,send=fetch){
 await logisticsSchema(env);const row=await env.DB.prepare('SELECT * FROM logistics_orders WHERE order_number=?').bind(number).first();if(!row)fail(404,'尚未建立物流單');
 const c=credentials(env);if(row.merchant_id!==c.merchant)fail(409,'物流商店編號已變更');
 const d=parse(await sendForm(env,'/Helper/QueryLogisticsTradeInfo/V5',{MerchantID:c.merchant,MerchantTradeNo:row.trade_no,TimeStamp:String(Math.floor(Date.now()/1000))},send));
 if(!verified(d,c))fail(409,'尚未取得可驗證的物流資料，請至綠界後台核對；不會重複建單');await saveResult(env,row,d,true);return publicRow(await env.DB.prepare('SELECT * FROM logistics_orders WHERE order_number=?').bind(number).first());
}
export async function logisticsNotify(request,env){
 if(request.method!=='POST')return new Response('0|POST required',{status:405});
 try{const d=parse(await request.text()),c=credentials(env);if(!verified(d,c))fail(400,'Invalid signature');await logisticsSchema(env);const row=await env.DB.prepare('SELECT * FROM logistics_orders WHERE trade_no=?').bind(d.MerchantTradeNo||'').first();if(!row)fail(400,'Unknown shipment');await saveResult(env,row,d);return new Response('1|OK');}catch{return new Response('0|Verification failed',{status:400});}
}
export async function printLogistics(env,number){
 await logisticsSchema(env);const row=await env.DB.prepare('SELECT * FROM logistics_orders WHERE order_number=?').bind(number).first(),c=credentials(env);
 if(!row||row.state!=='created'||!row.logistics_id||!row.payment_no||row.subtype==='UNIMARTC2C'&&!row.validation_no)fail(409,'請先查詢／同步物流，確認已取得完整寄貨編號');
 if(row.merchant_id!==c.merchant)fail(409,'物流商店編號已變更');
 const fields={MerchantID:c.merchant,AllPayLogisticsID:row.logistics_id,CVSPaymentNo:row.payment_no};if(row.subtype==='UNIMARTC2C'){fields.CVSValidationNo=row.validation_no;fields.PrintMode='1';}fields.CheckMacValue=logisticsMac(fields,c.key,c.iv);
 return {action:root+'/Express/'+(row.subtype==='UNIMARTC2C'?'PrintUniMartC2COrderInfo':'PrintFAMIC2COrderInfo'),fields};
}
export async function manageLogistics(request,env,url,admin,body){
 if(request.method==='GET'){if(url.searchParams.has('order'))return logisticsDetail(env,url.searchParams.get('order'));let ready=true;try{credentials(env);}catch{ready=false;}return {sender:await settings(env),credentialsReady:ready};}
 if(request.method!=='POST')fail(405,'不支援此操作');const d=await body(request);
 if(d.action==='settings'){
  if(!validLogisticsName(d.sender_name)||!/^09\d{8}$/.test(d.sender_phone||'')||!Number.isSafeInteger(d.version)||d.version<0)fail(400,'請確認寄件姓名及 09 開頭十碼手機');
  const old=await settings(env);if(old.version!==d.version)fail(409,'寄件設定已更新，請重新載入');
  await env.DB.batch([old.version?env.DB.prepare('UPDATE logistics_settings SET sender_name=?,sender_phone=?,version=version+1 WHERE id=1 AND version=?').bind(d.sender_name,d.sender_phone,d.version):env.DB.prepare('INSERT INTO logistics_settings(id,sender_name,sender_phone) VALUES (1,?,?)').bind(d.sender_name,d.sender_phone),env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),audit(env,admin,'logistics.settings','sender',{version:d.version+1})]);return {sender:await settings(env)};
 }
 await getOrder(env,d.orderNumber);
 if(d.action==='create')return {logistics:await createLogistics(env,admin,d.orderNumber)};
 if(d.action==='query')return {logistics:await queryLogistics(env,d.orderNumber)};
 if(d.action==='print')return printLogistics(env,d.orderNumber);
 if(d.action==='use-tracking'){
  const row=(await logisticsDetail(env,d.orderNumber)).logistics;if(!row?.payment_no||row.state!=='created')fail(409,'尚未取得寄貨編號');const tracking=row.payment_no+(row.validation_no||''),carrier=CVS_TYPES[row.subtype]+'（綠界超商純取貨）';
  const old=await env.DB.prepare('SELECT tracking FROM order_management WHERE order_number=?').bind(d.orderNumber).first();if(old?.tracking&&old.tracking!==tracking)fail(409,'訂單已有其他物流單號，請先核對');
  await env.DB.batch([env.DB.prepare("INSERT INTO order_management(order_number,admin_note,carrier,tracking,updated_at) VALUES (?,'',?,?,?) ON CONFLICT(order_number) DO UPDATE SET carrier=excluded.carrier,tracking=excluded.tracking,updated_at=excluded.updated_at,version=order_management.version+1 WHERE order_management.tracking='' OR order_management.tracking=excluded.tracking").bind(d.orderNumber,carrier,tracking,stamp()),env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),audit(env,admin,'logistics.tracking',d.orderNumber,{tracking})]);return {};
 }
 fail(400,'請選擇物流操作');
}
