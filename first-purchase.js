const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const defaults={TW:{region:'TW',title:'國內首購贈品優惠券',description:'wugong 墨水一瓶',kind:'ink',active:1,version:0},overseas:{region:'overseas',title:'海外首購贈品優惠券',description:'藏娥筆記本一本',kind:'other',active:1,version:0}};
export async function firstSchema(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS first_purchase_codes(code TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('ink','other')),region TEXT NOT NULL CHECK(region IN ('TW','overseas','all')),active INTEGER NOT NULL CHECK(active IN (0,1)),version INTEGER NOT NULL)").run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS first_purchase_redemptions(code TEXT NOT NULL REFERENCES first_purchase_codes(code),member_id TEXT NOT NULL,order_number TEXT NOT NULL UNIQUE REFERENCES orders(order_number),PRIMARY KEY(code,member_id))').run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS first_purchase_settings(region TEXT PRIMARY KEY CHECK(region IN ('TW','overseas')),title TEXT NOT NULL,description TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('ink','other')),active INTEGER NOT NULL CHECK(active IN (0,1)),version INTEGER NOT NULL)").run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS first_purchase_claims(member_id TEXT PRIMARY KEY,order_number TEXT NOT NULL UNIQUE REFERENCES orders(order_number))').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS first_purchase_gifts(order_number TEXT PRIMARY KEY REFERENCES orders(order_number),title TEXT NOT NULL,description TEXT NOT NULL,kind TEXT NOT NULL,region TEXT NOT NULL)').run();
}
export async function firstSettings(env){await firstSchema(env);const saved=(await env.DB.prepare('SELECT * FROM first_purchase_settings').all()).results;return Object.values(defaults).map(d=>saved.find(s=>s.region===d.region)||{...d});}
// Cancelled/expired orders do not consume eligibility; held orders reserve it.
const previousPen="SELECT 1 FROM member_orders mo JOIN orders o ON o.order_number=mo.order_number WHERE mo.member_id=? AND o.order_number!=? AND o.status NOT IN ('cancelled','expired','payment_failed')";
export async function firstGiftQuote(env,items,member,country,code=''){
 if(typeof code!=='string'||code.length>40)fail(400,'請確認首購券代碼');code=code.trim().toUpperCase();if(!country||!items.some(i=>i.category==='pen')){if(code)fail(400,'首購券須選擇收件國家並購買鋼筆');return null;}
 const settings=await firstSettings(env);await env.DB.prepare("DELETE FROM first_purchase_claims WHERE order_number IN (SELECT o.order_number FROM orders o LEFT JOIN checkout_reservations r ON r.order_number=o.order_number WHERE (r.state='released' OR (o.status IN ('cancelled','expired','payment_failed') AND COALESCE(r.state,'')!='sold')) AND NOT EXISTS(SELECT 1 FROM payment_receipts p WHERE p.order_number=o.order_number))").run();
 await env.DB.prepare("DELETE FROM first_purchase_redemptions WHERE order_number IN (SELECT order_number FROM orders o WHERE status IN ('cancelled','expired','payment_failed') AND NOT EXISTS(SELECT 1 FROM first_purchase_claims c WHERE c.order_number=o.order_number))").run();
 if(await env.DB.prepare(previousPen).bind(member,'').first()||await env.DB.prepare('SELECT 1 FROM first_purchase_claims WHERE member_id=?').bind(member).first()){if(code)fail(409,'此首購券僅限尚無有效購買紀錄的會員，且首購優惠每人限一次');return null;}
 if(code){const c=await env.DB.prepare('SELECT * FROM first_purchase_codes WHERE code=?').bind(code).first();if(!c||!c.active)fail(409,'首購券不存在或已停用');if(c.region!=='all'&&c.region!==(country==='TW'?'TW':'overseas'))fail(400,'此首購券不適用目前收件國家');if(c.kind==='ink'&&country!=='TW')fail(400,'墨水贈品僅寄送台灣');if(await env.DB.prepare('SELECT 1 FROM first_purchase_redemptions WHERE code=? AND member_id=?').bind(code,member).first())fail(409,'此首購券已使用或保留中');return c;}
 const s=settings.find(s=>s.region===(country==='TW'?'TW':'overseas'));return s.active?s:null;
}
export function firstGiftStatements(env,gift,member,order){if(!gift)return[];return[
 env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN NOT EXISTS('+previousPen+') THEN 1 ELSE 0 END').bind(member,order),
 ...(gift.code?[env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM first_purchase_codes WHERE code=? AND version=? AND active=1) THEN 1 ELSE 0 END').bind(gift.code,gift.version),env.DB.prepare('INSERT INTO first_purchase_redemptions(code,member_id,order_number) VALUES (?,?,?)').bind(gift.code,member,order)]:[env.DB.prepare("INSERT INTO catalog_checks(ok) SELECT CASE WHEN (?=0 AND NOT EXISTS(SELECT 1 FROM first_purchase_settings WHERE region=?)) OR EXISTS(SELECT 1 FROM first_purchase_settings WHERE region=? AND version=? AND active=1) THEN 1 ELSE 0 END").bind(gift.version,gift.region,gift.region,gift.version)]),
 env.DB.prepare('INSERT INTO first_purchase_claims(member_id,order_number) VALUES (?,?)').bind(member,order),
 env.DB.prepare('INSERT INTO first_purchase_gifts(order_number,title,description,kind,region) VALUES (?,?,?,?,?)').bind(order,gift.title,gift.description,gift.kind,gift.region)
];}
export async function firstGiftForOrder(env,order){try{return await env.DB.prepare('SELECT title,description,kind FROM first_purchase_gifts WHERE order_number=?').bind(order).first();}catch(e){if(!e.message.includes('no such table'))throw e;return null;}}
export async function manageFirstGift(request,env,url,m,body){
 if(url.pathname==='/api/admin/first-coupons')return manageFirstCodes(request,env,m,body);
 if(url.pathname!=='/api/admin/first-purchase')return null;
 if(request.method==='GET')return{settings:await firstSettings(env)};
 if(request.method!=='POST')return null;
 const d=await body(request);if(!['TW','overseas'].includes(d.region)||!['ink','other'].includes(d.kind)||![0,1].includes(d.active)||!Number.isSafeInteger(d.version)||d.version<0)fail(400,'請確認首購優惠券設定');
 for(const [key,max]of [['title',100],['description',500]])if(typeof d[key]!=='string'||!d[key].trim()||d[key].length>max)fail(400,'請填寫優惠券名稱及贈品說明');
 if(d.region==='overseas'&&d.kind==='ink')fail(400,'海外首購贈品不能設定為墨水');
 const old=(await firstSettings(env)).find(s=>s.region===d.region);if(old.version!==d.version)fail(409,'首購優惠券已更新，請重新載入');
 const next={region:d.region,title:d.title.trim(),description:d.description.trim(),kind:d.kind,active:d.active,version:d.version+1};
 const stmt=d.version===0?env.DB.prepare('INSERT INTO first_purchase_settings(region,title,description,kind,active,version) VALUES (?,?,?,?,?,1) ON CONFLICT(region) DO NOTHING').bind(d.region,next.title,next.description,d.kind,d.active):env.DB.prepare('UPDATE first_purchase_settings SET title=?,description=?,kind=?,active=?,version=version+1 WHERE region=? AND version=?').bind(next.title,next.description,d.kind,d.active,d.region,d.version);
 await env.DB.batch([stmt,env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),env.DB.prepare('INSERT INTO commerce_audit VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),m.id,'coupon.first-purchase',d.region,JSON.stringify(old),JSON.stringify(next),'首購贈品優惠券設定',new Date().toISOString())]);return{setting:next};
}

async function manageFirstCodes(request,env,m,body){
 await firstSchema(env);
 if(request.method==='GET')return{coupons:(await env.DB.prepare("SELECT c.*,(SELECT count(*) FROM first_purchase_redemptions r JOIN orders o ON o.order_number=r.order_number WHERE r.code=c.code AND o.status NOT IN ('cancelled','expired','payment_failed')) AS used FROM first_purchase_codes c ORDER BY code LIMIT 500").all()).results};
 if(request.method!=='POST')return null;
 const d=await body(request);if(typeof d.code!=='string'||!/^[-A-Za-z0-9_]{1,40}$/.test(d.code)||!['TW','overseas','all'].includes(d.region)||!['ink','other'].includes(d.kind)||![0,1].includes(d.active)||!Number.isSafeInteger(d.version)||d.version<0)fail(400,'請確認首購券代碼、收件地區與設定');
 for(const [key,max]of [['title',100],['description',500]])if(typeof d[key]!=='string'||!d[key].trim()||d[key].length>max)fail(400,'請填寫優惠券名稱及贈品說明');
 if(d.kind==='ink'&&d.region!=='TW')fail(400,'墨水首購券只能設定為台灣收件');
 const code=d.code.toUpperCase(),old=await env.DB.prepare('SELECT * FROM first_purchase_codes WHERE code=?').bind(code).first();if((old?.version||0)!==d.version)fail(409,'首購券已更新，請重新載入');
 if(await env.DB.prepare('SELECT 1 FROM promotions WHERE code=?').bind(code).first())fail(400,'此代碼已用於一般優惠券，請使用不同代碼');
 const next={code,title:d.title.trim(),description:d.description.trim(),region:d.region,kind:d.kind,active:d.active,version:d.version+1};
 const stmt=old?env.DB.prepare('UPDATE first_purchase_codes SET title=?,description=?,region=?,kind=?,active=?,version=version+1 WHERE code=? AND version=?').bind(next.title,next.description,d.region,d.kind,d.active,code,d.version):env.DB.prepare('INSERT INTO first_purchase_codes(title,description,region,kind,active,code,version) VALUES (?,?,?,?,?,?,1)').bind(next.title,next.description,d.region,d.kind,d.active,code);
 await env.DB.batch([stmt,env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),env.DB.prepare('INSERT INTO commerce_audit VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),m.id,'coupon.first-code',code,JSON.stringify(old||null),JSON.stringify(next),'首購專用券新增／修改',new Date().toISOString())]);return{coupon:next};
}
