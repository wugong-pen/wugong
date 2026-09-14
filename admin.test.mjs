import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from './worker.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE orders(id INTEGER PRIMARY KEY,order_number TEXT UNIQUE,customer_name TEXT,phone TEXT,email TEXT,address TEXT,shipping TEXT,payment TEXT,note TEXT,items TEXT,total INTEGER,status TEXT,created_at TEXT)');
 for(const file of ['schema-members.sql','schema-admin.sql','schema-payments.sql','schema-checkout.sql'])sql.exec(readFileSync(new URL(file,import.meta.url),'utf8'));
 const DB={prepare(query){let params=[];return{bind(...v){params=v;return this;},async first(){return sql.prepare(query).get(...params)||null;},async all(){return{results:sql.prepare(query).all(...params)};},async run(){return{meta:{changes:sql.prepare(query).run(...params).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,APP_ENV:'production',ASSETS:{fetch:async()=>new Response('page',{headers:{'Content-Type':'text/html'}})}};
 const call=async(path,method='GET',data,token='',headers={})=>{const r=await worker.fetch(new Request('https://shop.test'+path,{method,headers:{Origin:'https://shop.test','Content-Type':'application/json',Cookie:token,...headers},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);return{status:r.status,headers:r.headers,data:r.headers.get('Content-Type')?.includes('json')?await r.json():await r.text(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 return{sql,call,env};
}
test('administrator authentication, independent cookies, revocation and protected page aliases',async()=>{
 const {sql,call}=setup();
 const payload={email:'owner@example.test',password:'long administrator test password',name:'Owner',birthday:'1990-01-01',country:'TW',role:'admin',isAdmin:true};
 const registered=await call('/api/member/register','POST',payload);assert.equal(registered.status,200);
 assert.equal(sql.prepare('SELECT count(*) n FROM admin_members').get().n,0);
 for(const route of ['/api/orders','/api/admin/orders','/api/admin/session','/api/admin/orders/ORDER'])assert.equal((await call(route,'GET',undefined,registered.cookie)).status,403);
 assert.equal((await call('/api/admin/login','POST',payload)).status,401);
 for(const route of ['/admin','/admin/','/admin-orders','/admin-orders.html','/admin-orders/','/admin-order-detail.html']){const r=await call(route);assert.equal(r.status,303,route);assert.equal(r.headers.get('location'),'/admin-login.html');}
 for(const route of ['/admin-login','/admin-login.html','/admin.js','/admin.css'])assert.equal((await call(route)).status,200,route);
 sql.prepare('INSERT INTO admin_members VALUES (?,1,?)').run(registered.data.member.id,new Date().toISOString());
 assert.equal((await call('/api/admin/login','POST',payload,'',{Origin:'https://evil.test'})).status,403);
 const login=await call('/api/admin/login','POST',payload);assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict; Max-Age=3600/);
 assert.ok(!JSON.stringify(login.data).includes('password'));assert.equal((await call('/api/admin/session','GET',undefined,registered.cookie)).status,403);
 assert.equal((await call('/api/member','GET',undefined,login.cookie)).data.member,null);
 const stored=sql.prepare('SELECT token_hash FROM admin_sessions').get().token_hash;
 assert.notEqual(stored,login.cookie.split('=')[1]);assert.equal(stored,createHash('sha256').update(login.cookie.split('=')[1]).digest('hex'));
 const page=await call('/admin-orders.html','GET',undefined,login.cookie);assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');assert.match(page.headers.get('content-security-policy'),/script-src 'self';/);
 await call('/api/admin/logout','POST',{},login.cookie);assert.equal((await call('/api/admin/session','GET',undefined,login.cookie)).status,403);
 const second=await call('/api/admin/login','POST',payload);sql.exec('UPDATE admin_sessions SET expires_at=0');assert.equal((await call('/api/admin/session','GET',undefined,second.cookie)).status,403);
 const third=await call('/api/admin/login','POST',payload);sql.exec('UPDATE admin_members SET active=0');assert.equal((await call('/api/admin/session','GET',undefined,third.cookie)).status,403);
 sql.exec('UPDATE admin_members SET active=1');sql.exec('UPDATE members SET active=0');assert.equal((await call('/api/admin/session','GET',undefined,third.cookie)).status,403);
 sql.exec('UPDATE members SET active=1');assert.equal((await call('/api/member/password','POST',{currentPassword:payload.password,password:'replacement administrator password'},registered.cookie)).status,200);assert.equal((await call('/api/admin/session','GET',undefined,third.cookie)).status,403);
 sql.close();
});
test('order APIs require admin, paginate, restrict transitions, audit atomically and reject CSRF',async()=>{
 const {sql,call}=setup();
 const p={email:'owner@example.test',password:'long administrator test password',name:'Owner',birthday:'1990-01-01',country:'TW'};
 const reg=await call('/api/member/register','POST',p);sql.prepare('INSERT INTO admin_members VALUES (?,1,?)').run(reg.data.member.id,new Date().toISOString());
 const {cookie}=await call('/api/admin/login','POST',p);
 for(let i=0;i<25;i++)sql.prepare('INSERT INTO orders(order_number,customer_name,note,items,total,status,created_at) VALUES (?,?,?,?,?,?,?)').run('ORDER'+String(i).padStart(2,'0'),'<img src=x onerror=alert(1)>','<script>alert(1)</script>','[]',120000,i===0?'paid':'pending','2026-09-14');
 const first=await call('/api/orders','GET',undefined,cookie);assert.equal(first.data.orders.length,20);assert.equal(first.data.hasMore,true);assert.equal(first.headers.get('cache-control'),'no-store');
 const second=await call('/api/admin/orders?page=2','GET',undefined,cookie);assert.equal(second.data.orders.length,5);assert.equal(second.data.hasMore,false);
 assert.equal(new Set([...first.data.orders,...second.data.orders].map(o=>o.order_number)).size,25);
 for(const page of ['NaN','1.5','-1','Infinity'])assert.equal((await call('/api/admin/orders?page='+page,'GET',undefined,cookie)).status,400);
 assert.equal((await call('/api/admin/orders/ORDER00','GET',undefined,cookie)).data.order.total,120000);
 assert.equal((await call('/api/admin/orders/absent','GET',undefined,cookie)).status,404);
 assert.equal((await call('/api/admin/orders/%ZZ','GET',undefined,cookie)).status,400);
 const change={orderNumber:'ORDER00',expectedStatus:'paid',status:'shipped'};
 assert.equal((await call('/api/order/status','POST',change,reg.cookie)).status,403);
 for(const headers of [{Origin:'https://evil.test'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await call('/api/order/status','POST',change,cookie,headers)).status,403);
 for(const status of ['paid','test_paid','cancelled','refunded','__proto__'])assert.equal((await call('/api/order/status','POST',{...change,status},cookie)).status,409);
 assert.equal((await call('/api/order/status','POST',{...change,total:1},cookie)).status,400);
 assert.equal((await call('/api/order/status','POST',{...change,orderNumber:'ORDER01'},cookie)).status,409);
 assert.equal((await call('/api/order/status','POST',change,cookie)).status,200);
 assert.equal((await call('/api/order/status','POST',change,cookie)).status,409);
 assert.equal(sql.prepare("SELECT count(*) n FROM admin_audit WHERE action='order.status'").get().n,1);
 assert.equal(sql.prepare("SELECT total FROM orders WHERE order_number='ORDER00'").get().total,120000);
 assert.equal((await call('/api/admin/order/status','POST',{...change,expectedStatus:'shipped',status:'completed'},cookie)).status,200);
 assert.equal(sql.prepare("SELECT status FROM orders WHERE order_number='ORDER00'").get().status,'completed');
 // Simulate an audit-write failure: the order must remain unchanged.
 sql.exec("CREATE TRIGGER deny_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END; UPDATE orders SET status='paid' WHERE order_number='ORDER00';");
 assert.equal((await call('/api/order/status','POST',change,cookie)).status,500);
 assert.equal(sql.prepare("SELECT status FROM orders WHERE order_number='ORDER00'").get().status,'paid');
 sql.close();
});
test('admin login throttles password guesses without revealing account existence',async()=>{
 const {call,sql}=setup();
 for(let i=0;i<8;i++)assert.equal((await call('/api/admin/login','POST',{email:'absent@example.test',password:'wrong password'})).status,401);
 assert.equal((await call('/api/admin/login','POST',{email:'absent@example.test',password:'wrong password'})).status,429);sql.close();
});
