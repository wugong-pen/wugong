const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const stamp=()=>new Date().toISOString();
const str=(v,max=200)=>{if(typeof v!=='string'||v.length>max)fail(400,'文字欄位格式或長度不正確');return v.trim();};
const integer=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail(400,'請確認數字範圍');return v;};
const page=url=>integer(Number(url.searchParams.get('page')||1),1,100000);
const pattern=url=>'%'+str(url.searchParams.get('q')||'',100).replace(/[\\%_]/g,'\\$&')+'%';
const imagePath=v=>typeof v==='string'&&(/^\/media\/[a-f0-9]{64}$/.test(v)||/^\/?[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(v));
const publicProduct=p=>({sku:p.sku,family:p.family,name:p.name,variant:p.variant,description:p.description,category:p.category,price:p.price,images:JSON.parse(p.images),available:p.available,version:p.version});
const rows=async(env,query,...params)=>(await env.DB.prepare(query).bind(...params).all()).results;
const assertion=env=>env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END');
function audit(env,m,action,target,before,after,reason){return env.DB.prepare('INSERT INTO commerce_audit VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),m.id,action,target,JSON.stringify(before),JSON.stringify(after),reason,stamp());}
export async function catalogQuote(env,items){
 if(!Array.isArray(items)||items.length<1||items.length>50)fail(400,'請確認購物車商品');
 const counts=new Map(),result=[];
 for(const item of items){
  if(!item||typeof item!=='object')fail(400,'請確認購物車商品');
  const sku=str(item.id,100),p=await env.DB.prepare('SELECT * FROM products WHERE sku=? AND active=1').bind(sku).first();
  if(!p||item.nib!==p.variant)fail(409,'商品已下架或規格已變更，請重新加入購物車');
  const quantity=integer(item.quantity,1,99),count=(counts.get(sku)||0)+quantity;integer(count,1,99);counts.set(sku,count);
  result.push({id:sku,product:p.name,nib:p.variant,price:p.price,quantity,category:p.category,catalogVersion:p.version});
 }
 return {items:result,total:result.reduce((s,i)=>s+i.price*i.quantity,0),shippingFee:0,currency:'TWD'};
}
export function catalogGuards(env,items){return items.map(i=>env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM products WHERE sku=? AND version=? AND active=1 AND price=?) THEN 1 ELSE 0 END').bind(i.id,i.catalogVersion,i.price));}
export async function publicCommerce(request,env,url){
 if(url.pathname.startsWith('/media/')&&request.method==='GET'){
  const id=url.pathname.slice(7);if(!/^[a-f0-9]{64}$/.test(id))return new Response(null,{status:404});
  const f=await env.DB.prepare('SELECT mime,data FROM product_images WHERE id=?').bind(id).first();return f?new Response(new Uint8Array(f.data),{headers:{'Content-Type':f.mime,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}}):new Response(null,{status:404});
 }
 if(url.pathname==='/api/catalog'&&request.method==='GET'){
  let query='SELECT p.*,i.available FROM products p JOIN inventory i ON i.sku=p.sku WHERE p.active=1',params=[];
  for(const key of ['sku','family','category'])if(url.searchParams.get(key)){query+=` AND p.${key}=?`;params.push(str(url.searchParams.get(key),100));}
  if(url.searchParams.get('q')){query+=" AND p.name LIKE ? ESCAPE '\\'";params.push(pattern(url));}
  params.push((page(url)-1)*24);const result=await rows(env,query+' ORDER BY p.name,p.sku LIMIT 25 OFFSET ?',...params);return{products:result.slice(0,24).map(publicProduct),hasMore:result.length>24};
 }return null;
}
async function upload(request,env){
 const mime=request.headers.get('Content-Type');if(!['image/jpeg','image/png','image/webp'].includes(mime))fail(415,'請上傳 JPG、PNG 或 WebP 照片');
 if(Number(request.headers.get('Content-Length'))>1048576)fail(413,'照片請小於 1 MB');
 const reader=request.body?.getReader();if(!reader)fail(400,'缺少照片');let size=0;const chunks=[];
 for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>1048576){await reader.cancel();fail(413,'照片請小於 1 MB');}chunks.push(r.value);}
 const data=new Uint8Array(size);let pos=0;for(const c of chunks){data.set(c,pos);pos+=c.length;}
 const signature=mime==='image/jpeg'?data[0]===255&&data[1]===216&&data[2]===255:mime==='image/png'?data.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':new TextDecoder().decode(data.slice(0,4))==='RIFF'&&new TextDecoder().decode(data.slice(8,12))==='WEBP';
 if(size<24||!signature)fail(400,'照片格式無效');
 const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare('INSERT OR IGNORE INTO product_images VALUES (?,?,?,?)').bind(id,mime,data,stamp()).run();return{url:'/media/'+id};
}
export async function manageCommerce(request,env,url,m,body){
 const path=url.pathname,method=request.method;
 if(path==='/api/admin/images'&&method==='POST')return upload(request,env);
 if(path==='/api/admin/products'&&method==='GET'){
  const r=await rows(env,"SELECT p.*,i.available,i.sold FROM products p JOIN inventory i ON i.sku=p.sku WHERE (p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\') ORDER BY p.updated_at DESC,p.sku LIMIT 21 OFFSET ?",pattern(url),pattern(url),(page(url)-1)*20);return{products:r.slice(0,20).map(p=>({...publicProduct(p),active:p.active,sold:p.sold})),hasMore:r.length>20};
 }
 if(path==='/api/admin/product'&&method==='POST'){
  const d=await body(request),sku=str(d.sku,100);if(!/^[a-zA-Z0-9\u3400-\u9fff_-]{1,100}$/.test(sku))fail(400,'商品代碼僅能使用中英文字、數字、底線或連字號');
  const old=await env.DB.prepare('SELECT * FROM products WHERE sku=?').bind(sku).first();if((old?.version||0)!==d.version)fail(409,'商品已更新，請重新載入');
  const p={sku,family:str(d.family||sku,100),name:str(d.name,200),variant:str(d.variant,100),description:str(d.description||'',12000),category:str(d.category,20),price:integer(d.price,1,10000000),active:integer(d.active,0,1),images:d.images};
  if(!p.name||!p.variant||!['pen','ink','craft'].includes(p.category)||!Array.isArray(p.images)||p.images.length>6||!p.images.every(imagePath))fail(400,'請確認名稱、規格、分類與照片（最多六張）');
  for(const path of p.images.filter(i=>i.startsWith('/media/')))if(!await env.DB.prepare('SELECT id FROM product_images WHERE id=?').bind(path.slice(7)).first())fail(400,'照片不存在，請重新上傳');
  const statements=old?[env.DB.prepare('UPDATE products SET family=?,name=?,variant=?,description=?,category=?,price=?,images=?,active=?,version=version+1,updated_at=? WHERE sku=? AND version=?').bind(p.family,p.name,p.variant,p.description,p.category,p.price,JSON.stringify(p.images),p.active,stamp(),sku,d.version)]:[env.DB.prepare('INSERT INTO inventory(sku,available) VALUES (?,0)').bind(sku),env.DB.prepare('INSERT INTO products(sku,family,name,variant,description,category,price,images,active,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(sku,p.family,p.name,p.variant,p.description,p.category,p.price,JSON.stringify(p.images),p.active,stamp())];
  statements.push(assertion(env),audit(env,m,old?'product.update':'product.create',sku,old?{version:old.version,price:old.price,active:old.active}:null,{version:(old?.version||0)+1,price:p.price,active:p.active},'商品編輯'));await env.DB.batch(statements);return{sku};
 }
 if(path==='/api/admin/stock'&&method==='POST'){
  const d=await body(request),sku=str(d.sku,100),delta=integer(d.delta,-100000,100000),expected=integer(d.expected,0,100000000),reason=str(d.reason,500);if(!delta||!reason||expected+delta<0)fail(400,'請填寫增減數量與原因，可售庫存不能小於零');
  await env.DB.batch([env.DB.prepare('UPDATE inventory SET available=available+? WHERE sku=? AND available=? AND available+?>=0').bind(delta,sku,expected,delta),assertion(env),audit(env,m,'stock.adjust',sku,{available:expected},{available:expected+delta},reason)]);return{available:expected+delta};
 }
 if(path==='/api/admin/members'&&method==='GET'){
  const r=await rows(env,"SELECT m.id,m.name,m.email,m.phone,m.country,m.active,m.created_at,(SELECT count(*) FROM member_orders mo WHERE mo.member_id=m.id) AS order_count,EXISTS(SELECT 1 FROM admin_members a WHERE a.member_id=m.id AND a.active=1) AS is_admin FROM members m WHERE (m.email LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\') ORDER BY m.created_at DESC,m.id LIMIT 21 OFFSET ?",pattern(url),pattern(url),(page(url)-1)*20);return{members:r.slice(0,20),hasMore:r.length>20};
 }
 if(path==='/api/admin/member'&&method==='GET'){
  const id=str(url.searchParams.get('id')||'',100),member=await env.DB.prepare('SELECT id,name,email,phone,address,birthday,country,active,created_at FROM members WHERE id=?').bind(id).first();if(!member)fail(404,'找不到會員');
  const orders=await rows(env,'SELECT o.order_number,o.total,o.status,o.created_at FROM orders o JOIN member_orders mo ON mo.order_number=o.order_number WHERE mo.member_id=? ORDER BY o.created_at DESC LIMIT 21 OFFSET ?',id,(page(url)-1)*20);return{member,orders:orders.slice(0,20),hasMore:orders.length>20};
 }
 if(path==='/api/admin/member'&&method==='PATCH'){
  const d=await body(request),id=str(d.id,100),next=integer(d.active,0,1),expected=integer(d.expected,0,1),reason=str(d.reason,500);if(!reason||id===m.id||await env.DB.prepare('SELECT member_id FROM admin_members WHERE member_id=? AND active=1').bind(id).first())fail(400,'不能從會員管理停用自己或管理員，請填寫一般會員異動原因');
  await env.DB.batch([env.DB.prepare('UPDATE members SET active=?,updated_at=? WHERE id=? AND active=?').bind(next,stamp(),id,expected),assertion(env),env.DB.prepare('DELETE FROM member_sessions WHERE member_id=?').bind(id),env.DB.prepare('DELETE FROM admin_sessions WHERE member_id=?').bind(id),audit(env,m,'member.status',id,{active:expected},{active:next},reason)]);return{};
 }
 if(path==='/api/admin/order-management'&&method==='GET'){
  const number=str(url.searchParams.get('order')||'',60);if(!await env.DB.prepare('SELECT order_number FROM orders WHERE order_number=?').bind(number).first())fail(404,'找不到訂單');
  const management=await env.DB.prepare('SELECT * FROM order_management WHERE order_number=?').bind(number).first();const remittance=await env.DB.prepare("SELECT remittance_last5,remittance_date,reported_at,due_at FROM payment_attempts WHERE order_number=? AND provider='bank'").bind(number).first();return{management:management||{admin_note:'',carrier:'',tracking:'',version:0},remittance};
 }
 if(path==='/api/admin/order-management'&&method==='POST'){
  const d=await body(request),number=str(d.orderNumber,60),note=str(d.admin_note||'',4000),carrier=str(d.carrier||'',100),tracking=str(d.tracking||'',100),version=integer(d.version,0,1000000);if(!await env.DB.prepare('SELECT order_number FROM orders WHERE order_number=?').bind(number).first())fail(404,'找不到訂單');
  const old=await env.DB.prepare('SELECT * FROM order_management WHERE order_number=?').bind(number).first();if((old?.version||0)!==version)fail(409,'訂單備註已變更，請重新載入');
  const stmt=old?env.DB.prepare('UPDATE order_management SET admin_note=?,carrier=?,tracking=?,version=version+1,updated_at=? WHERE order_number=? AND version=?').bind(note,carrier,tracking,stamp(),number,version):env.DB.prepare('INSERT INTO order_management(order_number,admin_note,carrier,tracking,updated_at) VALUES (?,?,?,?,?)').bind(number,note,carrier,tracking,stamp());await env.DB.batch([stmt,assertion(env),audit(env,m,'order.notes',number,{version},{version:version+1},'更新內部備註與物流資料')]);return{};
 }
 if(path==='/api/admin/audit'&&method==='GET'){const r=await rows(env,'SELECT * FROM commerce_audit ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ?',(page(url)-1)*20);return{records:r.slice(0,20),hasMore:r.length>20};}
 return null;
}
