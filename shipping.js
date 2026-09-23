import {COUNTRY_CODES} from './countries.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export async function shippingSchema(env){
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS shipping_regions(country TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, fee INTEGER, note TEXT NOT NULL DEFAULT \'\', version INTEGER NOT NULL DEFAULT 1)').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS order_shipping(order_number TEXT PRIMARY KEY,country TEXT NOT NULL,fee INTEGER NOT NULL,version INTEGER NOT NULL)').run();
 await env.DB.batch(['TW','JP','KR','US','SG','HK'].map(c=>env.DB.prepare('INSERT OR IGNORE INTO shipping_regions(country,enabled,fee,note) VALUES (?,?,?,?)').bind(c,c==='TW'?1:0,c==='TW'?0:null,c==='US'?'歷史成本參考：包裹 24.3 × 15.2 × 10.25 cm，0.7 kg，運費 NT$1,544；物流、保險及關稅待確認。此數字不是對客收費。':'')));
 // Apply the owner's confirmed rates once, preserving later administrator changes.
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS shipping_migrations(id TEXT PRIMARY KEY)').run();
 const migration='owner-confirmed-rates-20260923';
 if(!await env.DB.prepare('SELECT 1 FROM shipping_migrations WHERE id=?').bind(migration).first()){
  const statements=[];
  for(const [country,fee] of [['JP',500],['KR',700],['SG',750],['HK',500],['US',1600]]){
   statements.push(env.DB.prepare("INSERT INTO commerce_audit SELECT ?,?,?,?,json_object('enabled',enabled,'fee',fee,'version',version),?,?,? FROM shipping_regions WHERE country=? AND NOT EXISTS(SELECT 1 FROM shipping_migrations WHERE id=?)").bind(crypto.randomUUID(),'owner-confirmed-deployment','shipping.update',country,JSON.stringify({enabled:1,fee}),'店主確認海外配送費率',new Date().toISOString(),country,migration));
   statements.push(env.DB.prepare('UPDATE shipping_regions SET enabled=1,fee=?,version=version+1 WHERE country=? AND NOT EXISTS(SELECT 1 FROM shipping_migrations WHERE id=?)').bind(fee,country,migration));
  }
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO shipping_migrations VALUES (?)').bind(migration));
  await env.DB.batch(statements);
 }
}
export async function shippingRegions(env,admin=false){await shippingSchema(env);const rows=(await env.DB.prepare('SELECT * FROM shipping_regions ORDER BY country').all()).results;return admin?rows:rows.filter(r=>r.enabled).map(({country,fee})=>({country,fee}));}
export async function shippingQuote(env,q,country,required=false){
 await shippingSchema(env);const row=await env.DB.prepare('SELECT * FROM shipping_regions WHERE country=?').bind(country||'').first();
 const reason=!country?'請選擇收件國家／地區':!row?.enabled?'此地區尚未開放配送':row.fee===null?'此地區運費尚未確認，請聯絡我們':'保留';
 const ready=!!row?.enabled&&Number.isSafeInteger(row.fee)&&row.fee>=0;
 if(required&&!ready)fail(400,reason);
 if(country&&country!=='TW'&&(q.items.some(i=>i.category==='ink')||q.coupon?.kind==='gift'&&q.coupon.gift_kind==='ink'))fail(400,'墨水（含贈品）僅寄送台灣，請移除墨水商品或更換優惠券後再結帳');
 q.shippingFee=ready?row.fee:null;q.shippingReady=ready;q.shippingMessage=ready?'':reason;q.shippingVersion=row?.version||0;q.shippingCountry=country||'';
 if(ready)q.total+=row.fee;
 return q;
}
export function shippingStatements(env,q,order){return [
 env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM shipping_regions WHERE country=? AND enabled=1 AND fee=? AND version=?) THEN 1 ELSE 0 END').bind(q.shippingCountry,q.shippingFee,q.shippingVersion),
 env.DB.prepare('INSERT INTO order_shipping VALUES (?,?,?,?)').bind(order,q.shippingCountry,q.shippingFee,q.shippingVersion)
];}
export async function manageShipping(request,env,url,m,body){
 if(url.pathname!=='/api/admin/shipping')return null;
 if(request.method==='GET')return {regions:await shippingRegions(env,true)};
 if(request.method!=='POST')fail(405,'不支援此操作');
 await shippingSchema(env);const d=await body(request);
 if(!COUNTRY_CODES.includes(d.country)||![0,1].includes(d.enabled)||!Number.isSafeInteger(d.version)||d.version<0||!(d.fee===null||Number.isSafeInteger(d.fee)&&d.fee>=0&&d.fee<=100000)||typeof d.note!=='string'||d.note.length>1000)fail(400,'請確認地區、運費及備註格式');
 if(d.enabled&&d.fee===null)fail(400,'請先填寫確認的運費，再開放配送');
 const old=await env.DB.prepare('SELECT * FROM shipping_regions WHERE country=?').bind(d.country).first();
 if((old?.version||0)!==d.version)fail(409,'配送設定已更新，請重新載入');
 const stmt=old?env.DB.prepare('UPDATE shipping_regions SET enabled=?,fee=?,note=?,version=version+1 WHERE country=? AND version=?').bind(d.enabled,d.fee,d.note.trim(),d.country,d.version):env.DB.prepare('INSERT INTO shipping_regions(country,enabled,fee,note) VALUES (?,?,?,?)').bind(d.country,d.enabled,d.fee,d.note.trim());
 await env.DB.batch([stmt,env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),env.DB.prepare('INSERT INTO commerce_audit VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),m.id,'shipping.update',d.country,JSON.stringify(old),JSON.stringify(d),'配送設定',new Date().toISOString())]);
 return {country:d.country};
}
