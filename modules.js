import {manageShipping} from './shipping.js';
import {manageFirstGift,firstSchema} from './first-purchase.js';
import {youtubeId} from './content-model.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const num=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail(400,'數字範圍不正確');return v;};
const text=(v,max=200)=>{if(typeof v!=='string'||v.length>max)fail(400,'文字格式不正確');return v.trim();};
const check=env=>env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END');
const audit=(env,m,action,target,before,after)=>env.DB.prepare('INSERT INTO commerce_audit VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),m.id,action,target,JSON.stringify(before),JSON.stringify(after),'模組管理',new Date().toISOString());
export function youtube(value){return value?youtubeId(value):'';}
export async function discountQuote(env,q,code,member){
 q.subtotal=q.total;q.discount=0;q.coupon=null;if(!code)return q;
 code=text(code,40).toUpperCase();await firstSchema(env);if(await env.DB.prepare('SELECT 1 FROM first_purchase_codes WHERE code=?').bind(code).first())fail(400,'這是首購券，請填入首購券代碼欄位');const c=await env.DB.prepare('SELECT * FROM promotions WHERE code=?').bind(code).first(),now=new Date().toISOString();
 if(!c||!c.active||c.starts>now||c.ends<=now)fail(409,'優惠券不存在、未開始或已到期');
 if(await env.DB.prepare('SELECT 1 FROM promotion_claims WHERE code=? AND member_id=?').bind(code,member).first())fail(409,'此優惠券已使用或有未完成訂單保留中');
 const count=await env.DB.prepare('SELECT count(*) AS n FROM promotion_claims WHERE code=?').bind(code).first();if(count.n>=c.quota)fail(409,'優惠券名額已用完');
 const eligible=q.items.filter(i=>c.scope==='all'||(c.scope==='family'?i.family===c.target:(i.category===c.target||i.categoryIds?.includes(c.target)))).reduce((sum,i)=>sum+i.price*i.quantity,0);
 if(!eligible||eligible<c.minimum)fail(409,'適用商品金額未達優惠券最低消費');
 q.discount=c.kind==='gift'?0:Math.min(c.maximum,eligible,c.kind==='fixed'?c.amount:Math.floor(eligible*c.amount/100));
 q.gift=c.kind==='gift'?c.gift_text:'';
 if((c.kind!=='gift'&&q.discount<1)||q.total-q.discount<1)fail(400,'折抵後訂單金額須至少為 NT$1');
 q.total-=q.discount;q.coupon=c;return q;
}
export function couponStatements(env,q,member,order){if(!q.coupon)return [];const c=q.coupon,now=new Date().toISOString();return [
 env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM promotions WHERE code=? AND version=? AND active=1 AND starts<=? AND ends>?) AND (SELECT count(*) FROM promotion_claims WHERE code=?)<? AND NOT EXISTS(SELECT 1 FROM promotion_claims WHERE code=? AND member_id=?) THEN 1 ELSE 0 END').bind(c.code,c.version,now,now,c.code,c.quota,c.code,member),
 env.DB.prepare('INSERT INTO promotion_claims VALUES (?,?,?,?)').bind(c.code,member,order,q.discount),env.DB.prepare('INSERT INTO order_discounts VALUES (?,?,?,?)').bind(order,c.code,q.subtotal,q.discount),...(c.kind==='gift'?[env.DB.prepare('INSERT INTO order_gifts VALUES (?,?,?)').bind(order,c.gift_text,c.gift_kind)]:[])];}
export async function manageModules(request,env,url,m,body){
 const shipping=await manageShipping(request,env,url,m,body);if(shipping!==null)return shipping;
 const first=await manageFirstGift(request,env,url,m,body);if(first!==null)return first;
 const path=url.pathname,method=request.method;
 if(path==='/api/admin/categories'){
  if(method==='GET')return{categories:(await env.DB.prepare('SELECT * FROM categories ORDER BY parent,name').all()).results};
  if(method==='POST'){
   const d=await body(request),id=text(d.id||'cat-'+crypto.randomUUID(),100),name=text(d.name,100),parent=d.parent?text(d.parent,100):null,kind=parent?text(d.kind,20):null;
   if(!name||! /^[a-zA-Z0-9_-]+$/.test(id))fail(400,'請填寫分類名稱');
   if(parent){const brand=await env.DB.prepare('SELECT * FROM categories WHERE id=? AND parent IS NULL').bind(parent).first();if(!brand||!['pen','ink','craft'].includes(kind))fail(400,'請選擇品牌及商品類型');}
   const old=await env.DB.prepare('SELECT * FROM categories WHERE id=?').bind(id).first();if((old?.version||0)!==d.version)fail(409,'分類已更新，請重新載入');
   if(old&&(old.parent!==parent||old.kind!==kind))fail(400,'分類建立後品牌與商品類型固定，可修改名稱或新增分類');
   if(await env.DB.prepare('SELECT id FROM categories WHERE name=? AND parent IS ? AND id!=?').bind(name,parent,id).first())fail(400,'此品牌內已有同名分類');
   const stmt=old?env.DB.prepare('UPDATE categories SET name=?,version=version+1 WHERE id=? AND version=?').bind(name,id,d.version):env.DB.prepare('INSERT INTO categories(id,name,parent,kind) VALUES (?,?,?,?)').bind(id,name,parent,kind);
   await env.DB.batch([stmt,check(env),audit(env,m,'category.update',id,old,{name,parent,kind})]);return{id};
  }
 }

 if(path==='/api/admin/copy-product'&&method==='POST'){
  const d=await body(request),family=text(d.family,100),source=(await env.DB.prepare('SELECT * FROM products WHERE family=? ORDER BY sku').bind(family).all()).results;if(!source.length)fail(404,'找不到商品');
  const target='item-'+crypto.randomUUID(),ss=[env.DB.prepare('INSERT INTO inventory(sku,available) VALUES (?,0)').bind('body-'+target),env.DB.prepare('INSERT INTO product_families(family,stock_sku,confirmed,video,threshold) SELECT ?,?,1,video,threshold FROM product_families WHERE family=?').bind(target,'body-'+target,family),check(env)];
  for(const [i,p] of source.entries()){const sku=target+'-'+i;ss.push(env.DB.prepare('INSERT INTO inventory(sku,available) VALUES (?,0)').bind(sku),env.DB.prepare('INSERT INTO products(sku,family,name,variant,description,category,price,images,active,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?)').bind(sku,target,p.name+'（副本）',p.variant,p.description,p.category,p.price,p.images,new Date().toISOString()));}
  for(let i=0;i<source.length;i++){ss.push(env.DB.prepare('INSERT INTO product_categories(sku,category_id) SELECT ?,category_id FROM product_categories WHERE sku=?').bind(target+'-'+i,source[i].sku));}
  ss.push(audit(env,m,'product.copy',target,{family},{variants:source.length,available:0}));await env.DB.batch(ss);return{family:target};
 }
 if(path==='/api/admin/nibs'){
  if(method==='GET')return{nibs:(await env.DB.prepare('SELECT * FROM nib_types ORDER BY name').all()).results};
  if(method==='POST'){const d=await body(request),name=text(d.name,100),active=num(d.active,0,1);if(!name)fail(400,'請填寫尖型名稱');await env.DB.batch([env.DB.prepare('INSERT INTO nib_types VALUES (?,?) ON CONFLICT(name) DO UPDATE SET active=excluded.active').bind(name,active),audit(env,m,'nib.update',name,null,{active})]);return{};}
 }
 if(path==='/api/admin/families'&&method==='GET')return{families:(await env.DB.prepare('SELECT f.*,i.available,i.sold,(SELECT name FROM products WHERE family=f.family LIMIT 1) AS name,(SELECT sum(available) FROM inventory WHERE sku IN(SELECT sku FROM products WHERE family=f.family)) AS legacy_available FROM product_families f JOIN inventory i ON i.sku=f.stock_sku ORDER BY f.family').all()).results};
 if(path==='/api/admin/family'&&method==='POST'){
  const d=await body(request),family=text(d.family,100),old=await env.DB.prepare('SELECT f.*,i.available FROM product_families f JOIN inventory i ON i.sku=f.stock_sku WHERE family=?').bind(family).first();if(!old||old.version!==d.version)fail(409,'筆款資料已更新，請重新載入');
  const threshold=num(d.threshold,0,100000),video=youtube(d.video),delta=num(d.delta||0,-100000,100000),reason=text(d.reason||'',500);
  if((delta||!old.confirmed)&&!reason)fail(400,'請填寫庫存核對或異動原因');if(!old.confirmed&&d.confirm!==true)fail(400,'請先核對實際可售筆身數量');
  if(old.available!==d.expected||old.available+delta<0)fail(409,'庫存已變更或不足，請重新載入');
  await env.DB.batch([env.DB.prepare('UPDATE product_families SET threshold=?,video=?,confirmed=1,version=version+1 WHERE family=? AND version=?').bind(threshold,video,family,d.version),check(env),env.DB.prepare('UPDATE inventory SET available=available+? WHERE sku=? AND available=? AND available+?>=0').bind(delta,old.stock_sku,d.expected,delta),check(env),audit(env,m,'family.stock',family,{available:old.available},{available:old.available+delta,threshold,video,reason})]);return{};
 }
 if(path==='/api/admin/coupons'&&method==='GET')return{coupons:(await env.DB.prepare('SELECT c.*,(SELECT count(*) FROM promotion_claims r WHERE r.code=c.code) AS used FROM promotions c ORDER BY code LIMIT 500').all()).results};
 if(path==='/api/admin/coupon'&&method==='GET'){const code=text(url.searchParams.get('code')||'',40);return{claims:(await env.DB.prepare('SELECT r.member_id,r.order_number,r.discount,o.status FROM promotion_claims r JOIN orders o ON o.order_number=r.order_number WHERE r.code=? ORDER BY o.created_at DESC LIMIT 100').bind(code).all()).results};}
 if(path==='/api/admin/coupon'&&method==='POST'){
  const d=await body(request),code=text(d.code,40).toUpperCase();if(!/^[A-Z0-9_-]{1,40}$/.test(code))fail(400,'折扣碼請使用英文字母、數字、底線或連字號');
  const kind=text(d.kind,20),scope=text(d.scope,20),target=text(d.target||'',100);if(!['fixed','percent','gift'].includes(kind)||!['all','family','category'].includes(scope))fail(400,'優惠券設定不正確');
  if(scope==='category'&&!['pen','ink','craft'].includes(target)&&!await env.DB.prepare('SELECT id FROM categories WHERE id=?').bind(target).first())fail(400,'請選擇適用分類');if(scope==='family'&&!await env.DB.prepare('SELECT family FROM product_families WHERE family=?').bind(target).first())fail(400,'請選擇適用商品');
  const amount=num(d.amount,kind==='gift'?0:1,kind==='percent'?100:10000000),minimum=num(d.minimum,0,10000000),maximum=num(d.maximum,kind==='gift'?0:1,10000000),quota=num(d.quota,1,1000000),active=num(d.active,0,1),gift_text=text(d.gift_text||'',500),gift_kind=text(d.gift_kind||'other',20);
  if(!['ink','other'].includes(gift_kind)||kind==='gift'&&(!gift_text||amount!==0||maximum!==0))fail(400,'贈品券請填寫贈品說明，折抵金額與上限須為 0');
  let starts,ends;try{starts=new Date(d.starts).toISOString();ends=new Date(d.ends).toISOString();}catch{fail(400,'請填寫有效起訖時間');}if(ends<=starts)fail(400,'結束時間須晚於開始時間');
  await firstSchema(env);if(await env.DB.prepare('SELECT 1 FROM first_purchase_codes WHERE code=?').bind(code).first())fail(400,'此代碼已用於首購券');
  const old=await env.DB.prepare('SELECT * FROM promotions WHERE code=?').bind(code).first();if((old?.version||0)!==d.version)fail(409,'優惠券已更新，請重新載入');
  const values=[kind,amount,minimum,maximum,scope,target,starts,ends,quota,active,gift_text,gift_kind];const stmt=old?env.DB.prepare('UPDATE promotions SET kind=?,amount=?,minimum=?,maximum=?,scope=?,target=?,starts=?,ends=?,quota=?,active=?,gift_text=?,gift_kind=?,version=version+1 WHERE code=? AND version=?').bind(...values,code,d.version):env.DB.prepare('INSERT INTO promotions(kind,amount,minimum,maximum,scope,target,starts,ends,quota,active,gift_text,gift_kind,code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...values,code);
  await env.DB.batch([stmt,check(env),audit(env,m,'coupon.update',code,old,{...d,code})]);return{};
 }
 return null;
}
