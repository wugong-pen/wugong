import {firstGiftQuote,firstGiftStatements,firstSchema,firstGiftForOrder,giftPhone} from './first-purchase.js';
import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import worker from './worker.js';import {catalogQuote,catalogGuards} from './commerce.js';
import {defaults} from './homepage-config.js';
import {youtubeId} from './content-model.js';
import {validateHomepage} from './homepage-config.js';
test('homepage supports multiple ordered slideshows and embedded videos with legacy defaults',async()=>{
 const {sql,call}=setup(),config=defaults();delete config.media;assert.deepEqual(validateHomepage(config).media,[]);
 config.media=[{type:'slideshow',title:'作品集',autoplay:true,interval:5,photos:[{src:'/28731.jpg',caption:'第一張'},{src:'/964161_0.jpg',caption:'第二張'}]},{type:'youtube',title:'工藝影片',id:'M7lc1UVf-VE'}];
 assert.equal((await call('/api/admin/homepage','POST',{config,version:0})).status,200);
 assert.deepEqual((await call('/api/homepage','GET',undefined,'')).data.config.media,config.media);
 for(const media of [[{...config.media[0],photos:[]}],[{...config.media[0],interval:1}],[{...config.media[0],photos:[{src:'https://other.test/photo.jpg',caption:''}]}],[{...config.media[1],id:'<script>alert(1)</script>'}]])assert.equal((await call('/api/admin/homepage','POST',{config:{...config,media},version:1})).status,400);
 assert.equal((await call('/api/admin/homepage','POST',{config:{...config,media:[...config.media].reverse()},version:1})).status,200);
 assert.equal((await call('/api/homepage','GET',undefined,'')).data.config.media[0].type,'youtube');sql.close();
});
test('content videos accept only YouTube IDs and verified URL shapes',()=>{
 for(const url of ['https://youtu.be/M7lc1UVf-VE','https://www.youtube.com/watch?v=M7lc1UVf-VE','https://www.youtube.com/shorts/M7lc1UVf-VE','https://www.youtube-nocookie.com/embed/M7lc1UVf-VE','<iframe width="560" height="315" src="https://www.youtube.com/embed/M7lc1UVf-VE?start=5&amp;rel=0" title="Video" allowfullscreen></iframe>'])assert.equal(youtubeId(url),'M7lc1UVf-VE');
 for(const url of ['javascript:alert(1)','https://evil.test/watch?v=M7lc1UVf-VE','https://www.youtube.com.evil.test/watch?v=M7lc1UVf-VE','https://secret@www.youtube.com/watch?v=M7lc1UVf-VE','https://youtu.be/bad','<script>alert(1)</script>','<iframe src="https://evil.test/video"></iframe>'])assert.throws(()=>youtubeId(url));
});
test('four content categories protect drafts, publish and archive safely, validate links and audit atomically',async()=>{
 const {sql,call}=setup();
 assert.deepEqual((await call('/api/content','GET',undefined,'')).data.entries,[]);
 assert.equal((await call('/api/admin/content','GET',undefined,'member')).status,403);
 const base={id:'',version:0,kind:'blog',status:'draft',title:'測試 <script>alert(1)</script>',summary:'文字摘要',date:'2026-09-16',cover:'/28731.jpg',source:'https://example.com/report',blocks:[{type:'text',text:'第一段\n第二行'},{type:'image',src:'/28731.jpg',caption:'作品照片'},{type:'youtube',id:'M7lc1UVf-VE',caption:'影片說明'}]};
 assert.equal((await call('/api/admin/content-entry','POST',base,'member')).status,403);
 assert.equal((await call('/api/admin/content-entry','POST',base,'admin',{Origin:'https://other.test'})).status,403);
 let draft=(await call('/api/admin/content-entry','POST',base)).data.entry;assert.equal(draft.version,1);
 assert.equal((await call('/api/content-entry?id='+draft.id,'GET',undefined,'')).status,404);
 assert.equal((await call('/api/content','GET',undefined,'')).data.entries.length,0);
 assert.equal((await call('/api/admin/content-entry?id='+draft.id)).data.entry.blocks[0].text,base.blocks[0].text);
 let published=(await call('/api/admin/content-entry','POST',{...draft,status:'published'})).data.entry;
 const detail=(await call('/api/content-entry?id='+draft.id,'GET',undefined,'')).data.entry;
 assert.equal(detail.title,base.title);assert.equal(detail.version,undefined);assert.equal(detail.status,undefined);
 assert.deepEqual(detail.blocks[2],base.blocks[2]);
 assert.equal((await call('/api/admin/content-entry','POST',draft)).status,409);
 for(const kind of ['awards','events','media'])assert.equal((await call('/api/admin/content-entry','POST',{...base,kind,status:'published'})).status,200);
 for(const kind of ['blog','awards','events','media']){const entries=(await call('/api/content?kind='+kind,'GET',undefined,'')).data.entries;assert.equal(entries.length,1);assert.equal(entries[0].kind,kind);assert.equal(entries[0].blocks,undefined);}
 for(const invalid of [{source:'javascript:alert(1)'},{source:'https://user:secret@example.test'},{cover:'https://example.test/a.jpg'},{cover:'/media/'+'0'.repeat(64)},{date:'2026-02-30'},{kind:'unknown'},{status:'unknown'},{blocks:[]},{blocks:[{type:'html',text:'<script>'}]},{blocks:[{type:'text',text:'a'.repeat(5001)}]}])assert.equal((await call('/api/admin/content-entry','POST',{...base,status:'published',...invalid})).status,400,JSON.stringify(invalid));
 assert.equal((await call('/api/content?page=-1','GET',undefined,'')).status,400);
 assert.equal((await call('/api/content?page=2','GET',undefined,'')).data.entries.length,0);
 assert.equal((await call('/api/admin/content?kind=blog&status=published&q='+encodeURIComponent('測試'))).data.entries.length,1);
 sql.exec("CREATE TRIGGER fail_content_audit BEFORE INSERT ON commerce_audit WHEN NEW.action='content.update' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
 assert.equal((await call('/api/admin/content-entry','POST',{...published,status:'archived'})).status,500);
 assert.equal((await call('/api/content-entry?id='+draft.id,'GET',undefined,'')).status,200);
 sql.exec('DROP TRIGGER fail_content_audit');
 const archived=(await call('/api/admin/content-entry','POST',{...published,status:'archived'})).data.entry;assert.equal(archived.version,3);
 assert.equal((await call('/api/content-entry?id='+draft.id,'GET',undefined,'')).status,404);
 assert.equal((await call('/api/content?kind=blog','GET',undefined,'')).data.entries.length,0);
 assert.equal((await call('/api/admin/content?kind=blog&status=archived')).data.entries.length,1);
 assert.equal((await call('/api/admin/content-entry','POST',{...archived,status:'published'})).data.entry.id,draft.id);
 assert.equal(sql.prepare("SELECT count(*) n FROM commerce_audit WHERE action LIKE 'content.%'").get().n,7);
 sql.close();
});
test('homepage saves persist, require admin and same origin, reject invalid settings and stale updates',async()=>{
 const {sql,call}=setup(),config=defaults();
 assert.equal((await call('/api/homepage','GET',undefined,'')).data.version,0);
 for(const role of ['','member'])assert.equal((await call('/api/admin/homepage','POST',{config,version:0},role)).status,403);
 assert.equal((await call('/api/admin/homepage','POST',{config,version:0},'admin',{Origin:'https://evil.test'})).status,403);
 config.texts.title.text='新的首頁 <img src=x onerror=alert(1)>';
 const saved=await call('/api/admin/homepage','POST',{config,version:0});assert.equal(saved.status,200);assert.equal(saved.data.version,1);
 assert.equal((await call('/api/homepage','GET',undefined,'')).data.config.texts.title.text,config.texts.title.text);
 assert.equal((await call('/api/admin/homepage','POST',{config,version:0})).status,409);
 assert.equal((await call('/api/admin/homepage','POST',{config:{...config,image:'https://other.test/photo.jpg'},version:1})).status,400);
 assert.equal((await call('/api/admin/homepage','POST',{config:{...config,image:'/media/'+'0'.repeat(64)},version:1})).status,400);
 for(const invalid of [{size:999},{color:'red;display:none'},{font:'__proto__'}]){const bad=structuredClone(config);Object.assign(bad.texts.title,invalid);assert.equal((await call('/api/admin/homepage','POST',{config:bad,version:1})).status,400);}
 config.background='#223344';assert.equal((await call('/api/admin/homepage','POST',{config,version:1})).data.version,2);
 assert.equal((await call('/api/admin/homepage','GET')).data.config.background,'#223344');
 assert.equal(sql.prepare("SELECT count(*) n FROM commerce_audit WHERE action='homepage.update'").get().n,2);
 assert.equal((await call('/?homepage-preview=1','GET',undefined,'')).status,303);
 sql.close();
});
function setup(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE orders(id INTEGER PRIMARY KEY,order_number TEXT UNIQUE,customer_name TEXT,phone TEXT,email TEXT,address TEXT,shipping TEXT,payment TEXT,note TEXT,items TEXT,total INTEGER,status TEXT,created_at TEXT)');for(const f of ['schema-members.sql','schema-admin.sql','schema-checkout.sql','schema-payments.sql','schema-commerce.sql','schema-homepage.sql','seed-inventory-staging.sql','seed-products.sql'])sql.exec(readFileSync(new URL(f,import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('schema-modules.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('schema-categories-gifts.sql',import.meta.url),'utf8'));sql.exec("UPDATE product_families SET confirmed=1; UPDATE inventory SET available=5 WHERE sku LIKE 'body-%';");
 const DB={prepare(q){let params=[];return{bind(...v){params=v;return this;},async first(){return sql.prepare(q).get(...params)||null;},async all(){return{results:sql.prepare(q).all(...params)};},async run(){return{meta:{changes:sql.prepare(q).run(...params).changes}};}};},async batch(ss){sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 for(const id of ['owner','customer'])sql.prepare('INSERT INTO members VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,id+'@example.test','password-hash',id,'1990-01-01','TW','','',1,'2026-09-14','2026-09-14');sql.exec("INSERT INTO admin_members VALUES ('owner',1,'now')");const token='a'.repeat(64),hash=createHash('sha256').update(token).digest('hex');sql.prepare('INSERT INTO admin_sessions VALUES (?,?,?,?)').run(hash,'owner','password-hash',Math.floor(Date.now()/1000)+3600);sql.prepare('INSERT INTO member_sessions VALUES (?,?,?)').run(hash,'customer',Math.floor(Date.now()/1000)+3600);
 const env={DB,APP_ENV:'staging',PAYMENT_ORIGIN:'https://wugong-test.wugong-pen.workers.dev',BANK_TEST_CONFIG:JSON.stringify({bank:'test',code:'test',branch:'test',holder:'test',account:'test',days:3})};
 const call=async(path,method='GET',data,kind='admin',extra={})=>{const headers={Origin:'https://shop.test','Content-Type':'application/json',Cookie:kind==='admin'?'__Host-wugong_admin='+token:kind==='member'?'__Host-wugong_session='+token:'',...extra};const r=await worker.fetch(new Request('https://shop.test'+path,{method,headers,...(data===undefined?{}:{body:data instanceof Uint8Array?data:JSON.stringify(data)})}),env);return{status:r.status,headers:r.headers,data:r.headers.get('Content-Type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer())};};return{sql,env,call};}
test('catalog CRUD changes pricing, archiving blocks checkout and stale edits roll back',async()=>{const{sql,env,call}=setup();
 assert.equal((await call('/api/catalog','GET',undefined,'')).data.products.length,6);
 assert.equal((await call('/api/admin/products','GET',undefined,'member')).status,403);
 const draft={sku:'new-ink',family:'new-ink',name:'墨水',variant:'藍色',description:'<script>not html</script>',category:'ink',price:600,active:0,images:[],version:0};
 assert.equal((await call('/api/admin/product','POST',draft)).status,200);assert.equal((await call('/api/catalog?sku=new-ink','GET',undefined,'')).data.products.length,0);
 assert.equal((await call('/api/admin/product','POST',{...draft,version:1,active:1})).status,200);
 const count=sql.prepare('SELECT count(*) n FROM commerce_audit').get().n;assert.equal((await call('/api/admin/product','POST',{...draft,version:1,price:1})).status,409);assert.equal(sql.prepare('SELECT count(*) n FROM commerce_audit').get().n,count);
 const q=await catalogQuote(env,[{id:'new-ink',nib:'藍色',quantity:2,price:1}]);assert.equal(q.total,1200);
 assert.equal((await call('/api/admin/family','POST',{family:'new-ink',version:1,threshold:2,delta:10,expected:0,reason:'進貨'})).status,200);
 const order={customer:{name:'test',country:'JP',address:'test',phone:'test'},items:[{id:'new-ink',nib:'藍色',quantity:1}],payment:'bank',expectedTotal:600};assert.equal((await call('/api/order','POST',order,'member',{'Idempotency-Key':'overseas-ink-00001'})).status,400);
 assert.equal((await call('/api/admin/product','POST',{...draft,version:2,active:0})).status,200);
 await assert.rejects(()=>env.DB.batch([...catalogGuards(env,q.items),env.DB.prepare("INSERT INTO orders(order_number) VALUES ('must-not-exist')")]));assert.equal(sql.prepare('SELECT count(*) n FROM orders').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM catalog_checks').get().n,0);
 await assert.rejects(()=>catalogQuote(env,[{id:'new-ink',nib:'藍色',quantity:1}]));sql.close();});
test('stock adjustments compare current availability and audit failures cannot alter stock',async()=>{const{call,sql}=setup();const d={family:'product-fuji',version:1,threshold:2,delta:3,expected:5,reason:'入庫'};assert.equal((await call('/api/admin/family','POST',d)).status,200);assert.equal((await call('/api/admin/family','POST',d)).status,409);assert.equal(sql.prepare("SELECT available FROM inventory WHERE sku='body-product-fuji'").get().available,8);assert.equal((await call('/api/admin/family','POST',{...d,version:2,expected:8,delta:-9})).status,409);assert.equal((await call('/api/admin/family','POST',{...d,version:2,reason:''})).status,400);assert.equal((await call('/api/admin/family','POST',{...d,version:2,expected:8},'admin',{Origin:'https://evil.test'})).status,403);sql.exec("CREATE TRIGGER deny_commerce_audit BEFORE INSERT ON commerce_audit BEGIN SELECT RAISE(ABORT,'audit failed'); END;");assert.equal((await call('/api/admin/family','POST',{...d,version:2,expected:8})).status,500);assert.equal(sql.prepare("SELECT available FROM inventory WHERE sku='body-product-fuji'").get().available,8);sql.close();});
test('members, order notes and images remain protected with no credential disclosure',async()=>{const{call,sql}=setup();const list=await call('/api/admin/members');assert.equal(list.status,200);assert.ok(!JSON.stringify(list.data).includes('password'));assert.equal((await call('/api/admin/member?id=customer')).status,200);assert.equal((await call('/api/admin/member','PATCH',{id:'owner',active:0,expected:1,reason:'test'})).status,400);assert.equal((await call('/api/admin/member','PATCH',{id:'customer',active:0,expected:1,reason:'停用'})).status,200);assert.equal(sql.prepare('SELECT count(*) n FROM member_sessions').get().n,0);
 sql.exec("INSERT INTO orders(order_number,total,status,created_at) VALUES ('ORDER',100,'pending','now')");const notes={orderNumber:'ORDER',admin_note:'內部備註',carrier:'郵局',tracking:'123456',version:0};assert.equal((await call('/api/admin/order-management','POST',notes)).status,200);assert.equal((await call('/api/admin/order-management','POST',notes)).status,409);assert.equal((await call('/api/admin/order-management?order=ORDER')).data.management.tracking,'123456');
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6v1UAAAAASUVORK5CYII=','base64'));assert.equal((await call('/api/admin/images','POST',png,'',{ 'Content-Type':'image/png'})).status,403);assert.equal((await call('/api/admin/images','POST',new Uint8Array(30),'admin',{'Content-Type':'image/png'})).status,400);assert.equal((await call('/api/admin/images','POST',png,'admin',{'Content-Type':'image/svg+xml'})).status,415);assert.equal((await call('/api/admin/images','POST',new Uint8Array(1048577),'admin',{'Content-Type':'image/png'})).status,413);
 const image=await call('/api/admin/images','POST',png,'admin',{'Content-Type':'image/png'});assert.equal(image.status,200);const file=await call(image.data.url,'GET',undefined,'');assert.equal(file.headers.get('Content-Type'),'image/png');assert.deepEqual(file.data,png);assert.equal((await call('/api/admin/audit','GET',undefined,'')).status,403);sql.close();});
import {discountQuote,couponStatements,youtube} from './modules.js';
import {reserveStatements,expireReservations,lockPayment,settlePayment} from './inventory.js';
test('shared pen bodies prevent overselling across nibs, retain old stock, and copy as zero-stock drafts',async()=>{
 const {sql,env,call}=setup();sql.exec("UPDATE inventory SET available=3 WHERE sku='body-product-pojun'");
 const q=await catalogQuote(env,[{id:'pojun-單尖',nib:'單尖',quantity:2},{id:'pojun-雙層特殊尖',nib:'雙層特殊尖',quantity:2}]);
 await assert.rejects(()=>env.DB.batch([env.DB.prepare("INSERT INTO orders(order_number) VALUES ('OVER')"),...reserveStatements(env,'OVER',q.items,'bank')]));assert.equal(sql.prepare("SELECT available FROM inventory WHERE sku='body-product-pojun'").get().available,3);
 const one=await catalogQuote(env,[{id:'pojun-單尖',nib:'單尖',quantity:1}]);await env.DB.batch([env.DB.prepare("INSERT INTO orders(order_number,status) VALUES ('ONE','pending')"),...reserveStatements(env,'ONE',one.items,'bank')]);
 assert.equal((await call('/api/catalog?family=product-pojun')).data.products.every(p=>p.available===2),true);assert.equal(sql.prepare("SELECT available FROM inventory WHERE sku='pojun-單尖'").get().available,5);
 sql.exec("UPDATE checkout_reservations SET expires_at='2000-01-01'");await expireReservations(env);await expireReservations(env);assert.equal(sql.prepare("SELECT available FROM inventory WHERE sku='body-product-pojun'").get().available,3);
 const copied=await call('/api/admin/copy-product','POST',{family:'product-pojun'});assert.equal(copied.status,200);assert.equal(sql.prepare('SELECT count(*) AS n FROM products WHERE family=? AND active=0').get(copied.data.family).n,4);assert.equal(sql.prepare('SELECT available FROM inventory WHERE sku=?').get('body-'+copied.data.family).available,0);
 assert.equal((await call('/api/admin/nibs','POST',{name:'新款三層尖',active:1})).status,200);assert.equal((await call('/api/admin/nibs','POST',{name:'單尖',active:0})).status,200);await assert.rejects(()=>env.DB.batch(catalogGuards(env,one.items)));await assert.rejects(()=>catalogQuote(env,[{id:'pojun-單尖',nib:'單尖',quantity:1}]));sql.close();
});
test('coupon eligibility, caps, one use per member, atomic quota, expiry release and paid use persist',async()=>{
 const {sql,env,call}=setup(),now=Date.now();const c={code:'SAVE',kind:'percent',amount:10,minimum:20000,maximum:3000,scope:'family',target:'product-pojun',starts:new Date(now-60000).toISOString(),ends:new Date(now+86400000).toISOString(),quota:1,active:1,version:0};
 assert.equal((await call('/api/admin/coupon','POST',c,'member')).status,403);assert.equal((await call('/api/admin/coupon','POST',c)).status,200);
 const items=[{id:'pojun-單尖',nib:'單尖',quantity:1},{id:'product-fuji',nib:'WUGONG 筆尖',quantity:1}],q=await discountQuote(env,await catalogQuote(env,items),'SAVE','customer');assert.equal(q.discount,2500);assert.equal(q.total,142500);
 await assert.rejects(async()=>discountQuote(env,await catalogQuote(env,[items[1]]),'SAVE','customer'));
 const create=(id,member,quote)=>env.DB.batch([env.DB.prepare("INSERT INTO orders(order_number,total,status,payment) VALUES (?,?,'pending','paypal')").bind(id,quote.total),...reserveStatements(env,id,quote.items,'paypal'),...couponStatements(env,quote,member,id)]);
 await create('COUPON1','customer',q);await assert.rejects(()=>create('COUPON2','other',q));assert.equal(sql.prepare("SELECT count(*) n FROM orders WHERE order_number='COUPON2'").get().n,0);await assert.rejects(async()=>discountQuote(env,await catalogQuote(env,items),'SAVE','customer'));
 sql.exec("UPDATE checkout_reservations SET expires_at='2000-01-01'");await expireReservations(env);assert.equal(sql.prepare('SELECT count(*) n FROM promotion_claims').get().n,0);
 const again=await discountQuote(env,await catalogQuote(env,items),'SAVE','customer');await create('COUPON3','customer',again);await lockPayment(env,'COUPON3');await settlePayment(env,{order_number:'COUPON3',total:again.total},'paypal','coupon-paid');await expireReservations(env);assert.equal(sql.prepare('SELECT count(*) n FROM promotion_claims').get().n,1);
 assert.equal(sql.prepare("SELECT discount FROM order_discounts WHERE order_number='COUPON1'").get().discount,2500);
 assert.equal((await call('/api/admin/coupon','POST',{...c,version:1,kind:'fixed',amount:999999,maximum:3000,quota:2})).status,200);const cap=await discountQuote(env,await catalogQuote(env,items),'SAVE','other').catch(e=>e);assert.equal(cap.discount,3000);sql.close();
});
test('YouTube embed parser accepts video identifiers and rejects arbitrary embeds',()=>{assert.equal(youtube('https://youtu.be/dQw4w9WgXcQ'),'dQw4w9WgXcQ');assert.equal(youtube('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>'),'dQw4w9WgXcQ');assert.throws(()=>youtube('<script>alert(1)</script>'));assert.throws(()=>youtube('https://evil.test/embed/dQw4w9WgXcQ'));});

test('brand categories reach public pages, copied products and coupon eligibility without losing ink restrictions',async()=>{
 const {sql,env,call}=setup();assert.equal((await call('/api/categories','GET',undefined,'')).data.categories.length,8);
 assert.equal((await call('/api/admin/categories','POST',{name:'非法',version:0},'member')).status,403);
 const created=await call('/api/admin/categories','POST',{name:'新系列',parent:'wugong',kind:'ink',version:0});assert.equal(created.status,200);const id=created.data.id;
 assert.equal((await call('/api/admin/categories','POST',{name:'子子分類',parent:id,kind:'pen',version:0})).status,400);
 const product={sku:'category-ink',family:'category-ink',name:'分類墨水',variant:'藍色',category:'craft',category_id:id,price:600,active:1,images:[],version:0};
 assert.equal((await call('/api/admin/product','POST',product)).status,200);
 assert.equal((await call('/api/catalog?category='+id)).data.products[0].category,'ink');
 assert.equal((await call('/api/catalog?category=wugong')).data.products.length,1);
 const copied=await call('/api/admin/copy-product','POST',{family:product.family});assert.equal(sql.prepare('SELECT category_id FROM product_categories WHERE sku=?').get(copied.data.family+'-0').category_id,id);
 const coupon={code:'BRAND',kind:'fixed',amount:100,minimum:0,maximum:100,scope:'category',target:'wugong',starts:new Date(Date.now()-60000).toISOString(),ends:new Date(Date.now()+86400000).toISOString(),quota:10,active:1,version:0};
 assert.equal((await call('/api/admin/coupon','POST',coupon)).status,200);assert.equal((await discountQuote(env,await catalogQuote(env,[{id:product.sku,nib:'藍色',quantity:1}]),'BRAND','customer')).discount,100);
 assert.equal((await call('/api/admin/categories','POST',{id,name:'新名稱',parent:'wugong',kind:'ink',version:1})).status,200);
 assert.equal((await call('/api/admin/categories','POST',{id,name:'新名稱',parent:'wugong',kind:'pen',version:2})).status,400);
 assert.equal((await call('/api/admin/product','POST',{...product,version:1,category_id:'missing'})).status,400);sql.close();
});

test('zero-value gift coupons create immutable order gifts, retain usage guards and reject overseas ink gifts',async()=>{
 const {sql,env,call}=setup(),c={code:'GIFT',kind:'gift',amount:0,maximum:0,minimum:100,scope:'all',target:'',gift_text:'贈送 wugong 墨水 1 瓶',gift_kind:'ink',starts:new Date(Date.now()-60000).toISOString(),ends:new Date(Date.now()+86400000).toISOString(),quota:1,active:1,version:0};
 assert.equal((await call('/api/admin/coupon','POST',{...c,gift_text:''})).status,400);assert.equal((await call('/api/admin/coupon','POST',c)).status,200);
 const items=[{id:'product-fuji',nib:'WUGONG 筆尖',quantity:1}],q=await discountQuote(env,await catalogQuote(env,items),'GIFT','customer');assert.equal(q.discount,0);assert.equal(q.total,120000);assert.equal(q.gift,c.gift_text);
 const order={customer:{name:'test',country:'JP',address:'test',phone:'+819012345678'},items,payment:'bank',expectedTotal:q.total,coupon:'GIFT'};
 assert.equal((await call('/api/order','POST',order,'member',{'Idempotency-Key':'gift-overseas-order'})).status,400);
 const r=await call('/api/order','POST',{...order,customer:{...order.customer,country:'TW'}},'member',{'Idempotency-Key':'gift-domestic-order'});assert.equal(r.status,200,JSON.stringify(r.data));
 const detail=await call('/api/admin/order-management?order='+r.data.orderNumber);assert.equal(detail.data.gift.description,c.gift_text+'；首購贈品：wugong 墨水一瓶');assert.equal(detail.data.discount.discount,0);
 assert.ok(sql.prepare('SELECT note FROM orders WHERE order_number=?').get(r.data.orderNumber).note.includes(c.gift_text));
 await assert.rejects(async()=>discountQuote(env,await catalogQuote(env,items),'GIFT','customer'));
 assert.equal((await call('/api/admin/coupon','POST',{...c,version:1,gift_text:'新贈品'})).status,200);
 assert.equal(sql.prepare('SELECT description FROM order_gifts WHERE order_number=?').get(r.data.orderNumber).description,c.gift_text);
 sql.exec("UPDATE checkout_reservations SET expires_at='2000-01-01'");await expireReservations(env);assert.equal(sql.prepare('SELECT count(*) n FROM promotion_claims').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM order_gifts').get().n,1);sql.close();
});

test('additive coupon migration preserves existing uses and rerunning never resurrects expired claims',()=>{
 const {sql}=setup();sql.exec("DELETE FROM commerce_migrations; INSERT INTO orders(order_number) VALUES ('OLD'); INSERT INTO coupons VALUES ('OLD', 'fixed', 100, 0, 100, 'all', '', '2026-01-01', '2027-01-01', 10, 1, 3); INSERT INTO coupon_claims VALUES ('OLD','customer','OLD',100)");
 const migration=readFileSync(new URL('schema-categories-gifts.sql',import.meta.url),'utf8');sql.exec(migration);assert.equal(sql.prepare("SELECT version FROM promotions WHERE code='OLD'").get().version,3);assert.equal(sql.prepare('SELECT count(*) n FROM promotion_claims').get().n,1);
 sql.exec("DELETE FROM promotion_claims; UPDATE promotions SET amount=200 WHERE code='OLD'");sql.exec(migration);assert.equal(sql.prepare('SELECT count(*) n FROM promotion_claims').get().n,0);assert.equal(sql.prepare("SELECT amount FROM promotions WHERE code='OLD'").get().amount,200);sql.close();
});

test('member service preserves order ownership, unique numbers, dates, versions and atomic audit',async()=>{
 const {sql,call}=setup();
 sql.prepare("INSERT INTO orders(order_number,items,total,status,created_at) VALUES (?,?,?,?,?)").run('OWNED','[{"product":"富士山","quantity":2,"nib":"WUGONG"}]',240000,'paid','2026-09-18');
 sql.prepare('INSERT INTO member_orders VALUES (?,?,?,?)').run('OWNED','customer','TW','owned-key');
 sql.prepare("INSERT INTO orders(order_number,items,total,status,created_at) VALUES (?,?,?,?,?)").run('OTHER','[]',120000,'paid','2026-09-18');
 sql.prepare('INSERT INTO member_orders VALUES (?,?,?,?)').run('OTHER','owner','TW','other-key');
 const info=await call('/api/admin/member?id=customer');assert.equal(info.data.member.birthday,'1990-01-01');assert.equal(info.data.orders.length,1);assert.match(info.data.orders[0].items,/富士山/);assert.equal(info.data.service.version,0);
 const data={id:'customer',member_number:'WG-001',version:0,warranties:[{product:'富士山',card:'CARD-001',start_date:'2026-09-18',end_date:'2027-09-18',order_number:'OWNED',note:'第一支'},{product:'富士山',card:'CARD-002',start_date:'2026-09-18',end_date:'2027-09-18',order_number:'OWNED',note:'第二支'}]};
 for(const role of ['','member'])assert.equal((await call('/api/admin/member-service','POST',data,role)).status,403);
 assert.equal((await call('/api/admin/member-service','POST',data,'admin',{Origin:'https://evil.test'})).status,403);
 for(const delta of [{end_date:'2025-01-01'},{start_date:'2026-02-30'},{order_number:'OTHER'}])assert.equal((await call('/api/admin/member-service','POST',{...data,warranties:[{...data.warranties[0],...delta}]})).status,400);
 const saved=await call('/api/admin/member-service','POST',data);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.service.warranties.length,2);
 assert.equal((await call('/api/admin/member-service','POST',data)).status,409);
 const current={id:'customer',...saved.data.service};assert.equal((await call('/api/admin/member-service','POST',{...current,warranties:[]})).status,400);
 assert.equal((await call('/api/admin/member-service','POST',{id:'owner',member_number:'WG-001',version:0,warranties:[]})).status,409);
 assert.equal((await call('/api/admin/member-service','POST',{id:'owner',member_number:'WG-002',version:0,warranties:[{...data.warranties[0],order_number:''}]})).status,409);
 assert.equal((await call('/api/admin/member?id=owner')).data.service.version,0);
 sql.exec("CREATE TRIGGER deny_service_audit BEFORE INSERT ON commerce_audit BEGIN SELECT RAISE(ABORT,'audit failed'); END;");
 assert.equal((await call('/api/admin/member-service','POST',{...current,member_number:'CHANGED'})).status,500);
 const after=await call('/api/admin/member?id=customer');assert.equal(after.data.service.member_number,'WG-001');assert.equal(after.data.service.version,1);assert.equal(after.data.service.warranties.length,2);
 sql.close();
});
test('manual members support editable profiles and purchases without creating login accounts or affecting orders',async()=>{
 const {sql,call}=setup();const data={id:'',version:0,name:'現場客人',email:'contact@example.test',birthday:'1985-04-03',country:'TW',phone:'0912345678',address:'台北',purchases:[{product:'富士山／F尖',date:'2025-06-01',quantity:1,amount:25000,source:'現場展售',note:'舊客戶補登'}]};
 for(const role of ['','member'])assert.equal((await call('/api/admin/member-profile','POST',data,role)).status,403);
 assert.equal((await call('/api/admin/member-profile','POST',data,'admin',{Origin:'https://evil.test'})).status,403);
 for(const change of [{birthday:'2026-02-30'},{birthday:'2999-01-01'},{country:'XX'},{email:'bad'},{purchases:[{...data.purchases[0],quantity:0}]}])assert.equal((await call('/api/admin/member-profile','POST',{...data,...change})).status,400);
 const created=await call('/api/admin/member-profile','POST',data);assert.equal(created.status,200,JSON.stringify(created.data));const id=created.data.id;
 const row=sql.prepare('SELECT * FROM members WHERE id=?').get(id);assert.equal(row.active,0);assert.equal(row.password_hash,'offline-contact');assert.notEqual(row.email,data.email);assert.equal(sql.prepare('SELECT count(*) n FROM orders').get().n,0);
 let detail=(await call('/api/admin/member?id='+id)).data;assert.equal(detail.member.email,data.email);assert.equal(detail.offline,true);assert.equal(detail.purchases[0].product,data.purchases[0].product);
 assert.equal((await call('/api/admin/members?q=contact')).data.members[0].id,id);
 const update={...data,id,version:detail.profile_version,updated_at:detail.member.updated_at,purchases:detail.purchases,name:'更正姓名'};assert.equal((await call('/api/admin/member-profile','POST',update)).status,200);assert.equal((await call('/api/admin/member-profile','POST',update)).status,409);
 assert.equal((await call('/api/admin/member-profile','POST',{...update,version:2,updated_at:(await call('/api/admin/member?id='+id)).data.member.updated_at,purchases:[]})).status,400);
 const warranty={id,version:0,member_number:'OFFLINE-001',warranties:[{product:'富士山',card:'CARD-001',start_date:'2025-06-01',end_date:'2027-06-01',order_number:'',note:'現場購買'}]};assert.equal((await call('/api/admin/member-service','POST',warranty)).status,200);
 detail=(await call('/api/admin/member?id='+id)).data;assert.equal(detail.member.name,'更正姓名');assert.equal(detail.service.member_number,'OFFLINE-001');assert.equal(detail.service.warranties[0].card,'CARD-001');
 assert.equal((await call('/api/admin/member-profile','POST',{...data,id:'customer',updated_at:'2026-09-14',email:'different@example.test'})).status,400);
 sql.exec("CREATE TRIGGER fail_profile_audit BEFORE INSERT ON commerce_audit WHEN NEW.action IN ('member.create','member.profile') BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
 assert.equal((await call('/api/admin/member-profile','POST',{...update,version:2,updated_at:detail.member.updated_at,name:'不得保存'})).status,500);assert.equal(sql.prepare('SELECT name FROM members WHERE id=?').get(id).name,'更正姓名');
 const before=sql.prepare('SELECT count(*) n FROM members').get().n;assert.equal((await call('/api/admin/member-profile','POST',data)).status,500);assert.equal(sql.prepare('SELECT count(*) n FROM members').get().n,before);sql.close();
});
test('first pen gift settings are editable, region-safe, atomic and shared across campaigns',async()=>{
 const {sql,env,call}=setup();const settings=(await call('/api/admin/first-purchase')).data.settings;assert.equal(settings[0].description,'wugong 墨水一瓶');assert.equal(settings[1].description,'藏娥筆記本一本');
 for(const role of ['','member'])assert.equal((await call('/api/admin/first-purchase','POST',settings[0],role)).status,403);
 assert.equal((await call('/api/admin/first-purchase','POST',settings[0],'admin',{Origin:'https://evil.test'})).status,403);
 assert.equal((await call('/api/admin/first-purchase','POST',{...settings[1],kind:'ink'})).status,400);
 const p=sql.prepare("SELECT * FROM products WHERE category='pen' LIMIT 1").get(),items=[{id:p.sku,nib:p.variant,quantity:1}];
 const quote=await call('/api/checkout/quote','POST',{items,country:'TW'},'member');assert.equal(quote.status,200);assert.equal(quote.data.firstGift.kind,'ink');assert.equal((await call('/api/checkout/quote','POST',{items,country:'JP'},'member')).data.firstGift.kind,'other');
 assert.equal(await firstGiftQuote(env,[{category:'ink'}],'customer','TW'),null);
 const changed={...settings[0],title:'春季首購',description:'限定墨水一瓶'};assert.equal((await call('/api/admin/first-purchase','POST',changed)).status,200);assert.equal((await call('/api/admin/first-purchase','POST',changed)).status,409);
 const order={items,customer:{name:'顧客',phone:'0900000000',address:'地址',country:'TW'},payment:'bank',expectedTotal:quote.data.total};let created=await call('/api/order','POST',order,'member',{'Idempotency-Key':'first-gift-order-001'});assert.equal(created.status,200,JSON.stringify(created.data));const number=created.data.orderNumber;
 assert.match(sql.prepare('SELECT note FROM orders WHERE order_number=?').get(number).note,/限定墨水一瓶/);assert.equal((await call('/api/checkout/quote','POST',{items,country:'JP'},'member')).data.firstGift,null);
 assert.equal((await call('/api/admin/order-management?order='+number)).data.gift.description,'首購贈品：限定墨水一瓶');
 assert.equal((await call('/api/admin/first-purchase','POST',{...changed,version:1,description:'另一瓶墨水'})).status,200);assert.equal(sql.prepare('SELECT description FROM first_purchase_gifts WHERE order_number=?').get(number).description,'限定墨水一瓶');
 sql.prepare("UPDATE checkout_reservations SET expires_at='2000-01-01' WHERE order_number=?").run(number);
 const retry=await call('/api/checkout/quote','POST',{items,country:'TW'},'member');assert.equal(retry.data.firstGift.description,'另一瓶墨水');
 // Two orders quoted before either writes must not both claim the gift.
 const a=await firstGiftQuote(env,retry.data.items,'customer','TW'),b=await firstGiftQuote(env,retry.data.items,'customer','JP');
 const create=number=>[env.DB.prepare("INSERT INTO orders(order_number,items,status) VALUES (?,'[]','pending')").bind(number),...firstGiftStatements(env,number==='RACE-A'?a:b,'customer',number,'+886900000000')];await env.DB.batch(create('RACE-A'));await assert.rejects(()=>env.DB.batch(create('RACE-B')));assert.equal(sql.prepare("SELECT count(*) n FROM orders WHERE order_number='RACE-B'").get().n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM first_purchase_claims WHERE member_id=?').get('customer').n,1);
 sql.exec("CREATE TRIGGER fail_first_audit BEFORE INSERT ON commerce_audit WHEN NEW.action='coupon.first-purchase' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");assert.equal((await call('/api/admin/first-purchase','POST',{...changed,version:2,active:0})).status,500);assert.equal((await call('/api/admin/first-purchase')).data.settings[0].active,1);sql.close();
});
test('first-only gift codes stack with ordinary coupons and never reset eligibility on edit or code change',async()=>{
 const {sql,call}=setup(),first={code:'FIRSTINK',title:'首購墨水券',description:'限定墨水一瓶',kind:'ink',region:'TW',active:1,version:0};
 for(const role of ['','member'])assert.equal((await call('/api/admin/first-coupons','POST',first,role)).status,403);
 assert.equal((await call('/api/admin/first-coupons','POST',first,'admin',{Origin:'https://evil.test'})).status,403);
 assert.equal((await call('/api/admin/first-coupons','POST',{...first,region:'all'})).status,400);
 assert.equal((await call('/api/admin/first-coupons','POST',first)).status,200);
 assert.equal((await call('/api/admin/first-coupons','POST',{...first,code:'FIRSTBOOK',kind:'other',region:'all',description:'筆記本一本'})).status,200);
 const ordinary={code:'SALE100',kind:'fixed',amount:100,maximum:100,minimum:0,scope:'all',target:'',starts:'2020-01-01',ends:'2099-01-01',quota:100,active:1,version:0};assert.equal((await call('/api/admin/coupon','POST',ordinary)).status,200);
 assert.equal((await call('/api/admin/coupon','POST',{...ordinary,code:first.code})).status,400);assert.equal((await call('/api/admin/first-coupons','POST',{...first,code:ordinary.code})).status,400);
 const items=[{id:'product-fuji',nib:'WUGONG 筆尖',quantity:1}];const payload={items,country:'TW',coupon:'SALE100',firstCoupon:'FIRSTINK'};
 let q=await call('/api/checkout/quote','POST',payload,'member');assert.equal(q.status,200,JSON.stringify(q.data));assert.equal(q.data.total,119900);assert.equal(q.data.firstGift.code,'FIRSTINK');
 assert.equal((await call('/api/checkout/quote','POST',{...payload,country:'JP'},'member')).status,400);assert.equal((await call('/api/checkout/quote','POST',{items,country:'TW',coupon:'FIRSTINK'},'member')).status,400);
 const order={items,customer:{name:'會員',phone:'0900000000',address:'地址',country:'TW'},coupon:'SALE100',firstCoupon:'FIRSTINK',expectedTotal:q.data.total,payment:'bank'};const r=await call('/api/order','POST',order,'member',{'Idempotency-Key':'combined-coupons-001'});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(sql.prepare('SELECT count(*) n FROM first_purchase_gifts').get().n,1);assert.equal(sql.prepare('SELECT code FROM first_purchase_redemptions').get().code,'FIRSTINK');assert.equal(sql.prepare('SELECT code FROM promotion_claims').get().code,'SALE100');assert.match(sql.prepare('SELECT note FROM orders WHERE order_number=?').get(r.data.orderNumber).note,/FIRSTINK/);
 sql.prepare("UPDATE orders SET status='paid' WHERE order_number=?").run(r.data.orderNumber);sql.prepare("UPDATE checkout_reservations SET state='sold' WHERE order_number=?").run(r.data.orderNumber);
 for(const firstCoupon of ['FIRSTINK','FIRSTBOOK'])assert.equal((await call('/api/checkout/quote','POST',{items,country:'TW',firstCoupon},'member')).status,409);
 assert.equal((await call('/api/admin/first-coupons','POST',{...first,version:1,description:'更改贈品'})).status,200);assert.equal((await call('/api/checkout/quote','POST',{items,country:'TW',firstCoupon:'FIRSTINK'},'member')).status,409);assert.equal(sql.prepare('SELECT description FROM first_purchase_gifts').get().description,first.description);
 assert.equal((await call('/api/checkout/quote','POST',{items,country:'TW',coupon:'SALE100'},'member')).status,409);assert.equal((await call('/api/admin/coupon','POST',{...ordinary,version:1,amount:80})).status,200);assert.equal((await call('/api/checkout/quote','POST',{items,country:'TW',coupon:'SALE100'},'member')).status,409);
 assert.equal((await call('/api/admin/first-coupons')).data.coupons.find(c=>c.code==='FIRSTINK').used,1);sql.prepare("UPDATE orders SET status='cancelled' WHERE order_number=?").run(r.data.orderNumber);assert.equal((await call('/api/checkout/quote','POST',{items,country:'TW',firstCoupon:'FIRSTINK'},'member')).status,200);assert.equal(sql.prepare('SELECT count(*) n FROM first_purchase_redemptions').get().n,0);
 sql.exec("CREATE TRIGGER deny_first_code_audit BEFORE INSERT ON commerce_audit WHEN NEW.action='coupon.first-code' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");assert.equal((await call('/api/admin/first-coupons','POST',{...first,version:2,active:0})).status,500);assert.equal(sql.prepare("SELECT active FROM first_purchase_codes WHERE code='FIRSTINK'").get().active,1);sql.close();
});

test('phone normalization equates international and local forms without conflating countries',()=>{
 for(const phone of ['0912-345-678','+886 912 345 678','00886 912345678','886912345678','+886 (0)912345678','０９１２３４５６７８'])assert.equal(giftPhone(phone,'TW'),'+886912345678');
 assert.equal(giftPhone('090-1234-5678','JP'),'+819012345678');assert.equal(giftPhone('+81 (0)90 1234 5678','TW'),'+819012345678');
 assert.equal(giftPhone('010-1234-5678','KR'),'+821012345678');assert.equal(giftPhone('(415) 555-0123','US'),'+14155550123');assert.equal(giftPhone('1-415-555-0123','US'),'+14155550123');
 assert.equal(giftPhone('9123 4567','SG'),'+6591234567');assert.equal(giftPhone('6591234567','SG'),'+6591234567');
 for(const invalid of ['test','000','+12abc345678','+123;45678','+1234567890123456'])assert.equal(giftPhone(invalid,'TW'),'');
});

test('first gifts are held until administrator completes, never touch gift stock, and cancellation restores member and phone',async()=>{
 const {sql,env,call}=setup(),items=[{id:'product-fuji',nib:'WUGONG 筆尖',quantity:1}],order={items,customer:{name:'顧客',phone:'0912345678',address:'地址',country:'TW'},payment:'bank',expectedTotal:120000};
 const before=sql.prepare('SELECT * FROM inventory ORDER BY sku').all();
 const created=await call('/api/order','POST',order,'member',{'Idempotency-Key':'gift-lifecycle-00001'});assert.equal(created.status,200,JSON.stringify(created.data));const number=created.data.orderNumber;
 assert.equal((await firstGiftForOrder(env,number)).state,'reserved');assert.match(sql.prepare('SELECT note FROM orders WHERE order_number=?').get(number).note,/如贈品送完/);
 for(const row of before){const after=sql.prepare('SELECT * FROM inventory WHERE sku=?').get(row.sku);assert.equal(after.available,row.available-(row.sku==='body-product-fuji'?1:0));assert.equal(after.sold,row.sold);}
 const otherMember='other-account';
 assert.equal(await firstGiftQuote(env,[{category:'pen'}],otherMember,'TW','','+886 912 345 678'),null);
 assert.ok(await firstGiftQuote(env,[{category:'pen'}],otherMember,'TW','','0912345679'));
 // Start bank transfer (without a report), then cancel through the authenticated admin route.
 assert.equal((await call('/api/payments/start','POST',{orderNumber:number},'member')).status,200);
 const cancel={orderNumber:number,expectedStatus:'pending',status:'cancelled'};
 assert.equal((await call('/api/admin/order/status','POST',cancel,'member')).status,403);
 assert.equal((await call('/api/admin/order/status','POST',cancel,'admin',{Origin:'https://evil.test'})).status,403);
 assert.equal((await call('/api/admin/order/status','POST',cancel)).status,200);
 assert.equal((await call('/api/admin/order/status','POST',cancel)).status,409);
 assert.deepEqual(sql.prepare('SELECT * FROM inventory ORDER BY sku').all(),before);
 assert.equal((await firstGiftForOrder(env,number)).state,'released');assert.equal(sql.prepare('SELECT count(*) n FROM first_purchase_claims').get().n,0);
 assert.ok(await firstGiftQuote(env,[{category:'pen'}],'customer','TW','','0912345678'));
 assert.ok(await firstGiftQuote(env,[{category:'pen'}],otherMember,'TW','','+886912345678'));
 const again=await call('/api/order','POST',order,'member',{'Idempotency-Key':'gift-lifecycle-00002'});assert.equal(again.status,200);const number2=again.data.orderNumber;
 assert.equal((await call('/api/payments/start','POST',{orderNumber:number2},'member')).status,200);
 const row=sql.prepare('SELECT * FROM orders WHERE order_number=?').get(number2);await settlePayment(env,row,'paypal','gift-test-transaction');
 assert.equal((await firstGiftForOrder(env,number2)).state,'reserved');
 assert.equal((await call('/api/admin/order/status','POST',{orderNumber:number2,expectedStatus:'test_paid',status:'shipped'})).status,200);
 assert.equal((await firstGiftForOrder(env,number2)).state,'reserved');
 sql.exec("CREATE TRIGGER gift_audit_failure BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT,'audit failure'); END");
 const complete={orderNumber:number2,expectedStatus:'shipped',status:'completed'};
 assert.equal((await call('/api/admin/order/status','POST',complete)).status,500);assert.equal((await firstGiftForOrder(env,number2)).state,'reserved');sql.exec('DROP TRIGGER gift_audit_failure');
 assert.equal((await call('/api/admin/order/status','POST',complete)).status,200);assert.equal((await firstGiftForOrder(env,number2)).state,'received');
 assert.equal(await firstGiftQuote(env,[{category:'pen'}],otherMember,'TW','','+886912345678'),null);
 // A completed order cancelled by a verified refund workflow must release eligibility even with a retained receipt.
 sql.prepare("UPDATE orders SET status='cancelled' WHERE order_number=?").run(number2);
 assert.ok(await firstGiftQuote(env,[{category:'pen'}],'customer','TW','','+886912345678'));
 assert.equal(sql.prepare('SELECT count(*) n FROM payment_receipts').get().n,1);assert.equal(sql.prepare('SELECT count(*) n FROM first_purchase_gifts').get().n,2);
 sql.close();
});

test('different accounts quoted before either writes cannot reserve the same phone twice',async()=>{
 const {sql,env}=setup();await firstSchema(env);const gift=await firstGiftQuote(env,[{category:'pen'}],'customer','TW','','0912345678');
 const statements=(number,member)=>[env.DB.prepare("INSERT INTO orders(order_number,status) VALUES (?,'pending')").bind(number),...firstGiftStatements(env,gift,member,number,'+886912345678')];
 await env.DB.batch(statements('PHONE-A','customer'));
 await assert.rejects(()=>env.DB.batch(statements('PHONE-B','other-account')));
 assert.equal(sql.prepare("SELECT count(*) n FROM orders WHERE order_number='PHONE-B'").get().n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM first_purchase_phones').get().n,1);
 sql.prepare("UPDATE orders SET status='cancelled' WHERE order_number='PHONE-A'").run();
 await env.DB.batch(statements('PHONE-C','other-account'));
 assert.equal(sql.prepare('SELECT count(*) n FROM first_purchase_claims').get().n,1);sql.close();
});

test('legacy phone history is indexed and safe cancellation cannot release uncertain or reported payments',async()=>{
 const {sql,env,call}=setup();await firstSchema(env);
 sql.exec("INSERT INTO orders(order_number,phone,status) VALUES ('LEGACY','0912-345-678','completed'); INSERT INTO member_orders VALUES ('LEGACY','customer','TW','legacy-gift-key'); INSERT INTO first_purchase_gifts VALUES ('LEGACY','首購','墨水','ink','TW')");
 assert.equal(await firstGiftQuote(env,[{category:'pen'}],'new-account','TW','','+886912345678'),null);
 const first={code:'ONCE',title:'一次',description:'筆記本',kind:'other',region:'all',active:1,version:0};assert.equal((await call('/api/admin/first-coupons','POST',first)).status,200);
 const items=[{id:'product-fuji',nib:'WUGONG 筆尖',quantity:1}];const order={items,customer:{name:'顧客',phone:'0912345679',address:'地址',country:'TW'},payment:'bank',expectedTotal:120000};
 // Existing buyer still purchases normally, with no extra gift.
 const made=await call('/api/order','POST',order,'member',{'Idempotency-Key':'reported-no-cancel-01'});assert.equal(made.status,200);const number=made.data.orderNumber;
 assert.equal((await call('/api/payments/start','POST',{orderNumber:number},'member')).status,200);
 sql.prepare("UPDATE payment_attempts SET reported_at='2026-09-22' WHERE order_number=?").run(number);
 const before=sql.prepare('SELECT * FROM inventory ORDER BY sku').all();const cancel={orderNumber:number,expectedStatus:'pending',status:'cancelled'};
 assert.equal((await call('/api/admin/order/status','POST',cancel)).status,409);assert.deepEqual(sql.prepare('SELECT * FROM inventory ORDER BY sku').all(),before);
 sql.prepare('UPDATE payment_attempts SET reported_at=NULL WHERE order_number=?').run(number);sql.prepare("UPDATE orders SET payment='paypal' WHERE order_number=?").run(number);
 assert.equal((await call('/api/admin/order/status','POST',cancel)).status,409);assert.deepEqual(sql.prepare('SELECT * FROM inventory ORDER BY sku').all(),before);sql.close();
});
