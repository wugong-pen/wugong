import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from './worker.js';
import {blankNewsletter,validateNewsletter,newsletterContent} from './newsletter-model.js';
import {newsletterSchema,newsletterPreferenceStatement,memberNewsletter,manageNewsletters,prepareNewsletterDeliveries,newsletterUnsubscribe} from './newsletter-store.js';
import {drainNotifications} from './order-notifications.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE orders(order_number TEXT PRIMARY KEY,status TEXT,created_at TEXT);CREATE TABLE product_images(id TEXT PRIMARY KEY)');
 for(const file of ['schema-members.sql','schema-admin.sql'])sql.exec(readFileSync(new URL(file,import.meta.url),'utf8'));
 const DB={prepare(q){let p=[];return{bind(...v){p=v;return this;},async first(){return sql.prepare(q).get(...p)||null;},async all(){return{results:sql.prepare(q).all(...p)};},async run(){return{meta:{changes:sql.prepare(q).run(...p).changes}};}};},async batch(ss){sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,APP_ENV:'production',RESEND_API_KEY:'fake',MAIL_FROM:'WUGONG <noreply@example.test>',MAIL_ORIGIN:'https://shop.test'},admin={id:'admin'};
 const call=(data,query='')=>manageNewsletters(new Request('https://shop.test/api/admin/newsletters'+query,{method:data?'POST':'GET'}),env,new URL('https://shop.test/api/admin/newsletters'+query),admin,async()=>data);
 const addBuyer=async(id,country='TW',enabled=true,verified=true,status='completed')=>{
  sql.prepare("INSERT INTO members(id,email,password_hash,name,birthday,country,created_at,updated_at) VALUES (?,?,'hash',?,'1990-01-01',?,'2026-01-01','2026-01-01')").run(id,id+'@example.test',id,country);
  if(verified)sql.prepare('INSERT INTO member_email_verified VALUES (?,?)').run(id,Date.now());
  sql.prepare('INSERT INTO orders VALUES (?,?,?)').run(id,status,'2026-01-01');sql.prepare('INSERT INTO member_orders VALUES (?,?,?,?)').run(id,id,country,id);
  await newsletterPreferenceStatement(env,{id,email:id+'@example.test'},enabled).run();
 };
 return{sql,env,call,addBuyer};
}
test('newsletter validates fields and renders escaped bilingual HTML with safe images and links',()=>{
 const d={...blankNewsletter(),subject:'活動 <img src=x>',zh:'你好\n<script>alert(1)</script>',en:'Hello',link:'https://shop.test/event',linkLabel:'看活動'};
 const p=newsletterContent(validateNewsletter(d),'https://shop.test','https://shop.test/unsubscribe');assert.match(p.html,/&lt;script&gt;/);assert.ok(!p.html.includes('<script>'));assert.match(p.text,/Hello/);assert.match(p.html,/取消活動電子報訂閱/);
 for(const bad of [undefined,{...d,subject:'x\r\nBcc:evil'},{...d,link:'javascript:alert(1)'},{...d,link:'https://user:pass@evil.test/'},{...d,image:'https://evil.test/pixel'},{...d,audience:'everyone'},{...d,zh:'',en:''}])assert.throws(()=>validateNewsletter(bad));
});
test('explicit consent and verified real buyers only, domestic/overseas segments and stale confirmations',async()=>{
 const {sql,env,call,addBuyer}=setup();await newsletterSchema(env);
 await addBuyer('tw');await addBuyer('jp','JP');await addBuyer('no','TW',false);await addBuyer('unverified','TW',true,false);await addBuyer('pending','TW',true,true,'pending');await addBuyer('simulated');sql.exec("INSERT INTO admin_audit(id,member_id,action,order_number,previous_status,created_at) VALUES ('sim','admin','order.status','simulated','test_paid','2026-01-01')");
 let d=(await call({action:'save',campaign:{...blankNewsletter(),subject:'活動',zh:'歡迎'}})).campaign;
 const approval=await call({action:'prepare',id:d.id,version:d.version});assert.equal(approval.count,2);
 await newsletterPreferenceStatement(env,{id:'jp',email:'jp@example.test'},false).run();await assert.rejects(call({action:'send',id:d.id,token:approval.token}),{status:409});assert.equal(sql.prepare('SELECT count(*) n FROM newsletter_recipients').get().n,0);
 d=(await call({action:'save',campaign:{...d,audience:'domestic'}})).campaign;const local=await call({action:'prepare',id:d.id,version:d.version});assert.equal(local.count,1);
 d=(await call({action:'save',campaign:{...d,subject:'修正主旨'}})).campaign;await assert.rejects(call({action:'send',id:d.id,token:local.token}),{status:409});
 await newsletterPreferenceStatement(env,{id:'jp',email:'jp@example.test'},true).run();d=(await call({action:'save',campaign:{...d,audience:'overseas'}})).campaign;assert.equal((await call({action:'prepare',id:d.id,version:d.version})).count,1);sql.close();
});
test('send is atomic and idempotent, content locks, consent rechecked and HTML delivered once',async()=>{
 const {sql,env,call,addBuyer}=setup();await newsletterSchema(env);await addBuyer('tw');await addBuyer('jp','JP');
 const d=(await call({action:'save',campaign:{...blankNewsletter(),subject:'新品活動',zh:'中文',en:'English'}})).campaign;
 const a=await call({action:'prepare',id:d.id,version:d.version});
 sql.exec("CREATE TRIGGER fail_audience BEFORE INSERT ON newsletter_recipients BEGIN SELECT RAISE(ABORT,'failure'); END");await assert.rejects(call({action:'send',id:d.id,token:a.token}));assert.equal(sql.prepare('SELECT state FROM newsletter_campaigns').get().state,'draft');sql.exec('DROP TRIGGER fail_audience');
 await call({action:'send',id:d.id,token:a.token});await call({action:'send',id:d.id,token:a.token});assert.equal(sql.prepare('SELECT count(*) n FROM newsletter_recipients').get().n,2);await assert.rejects(call({action:'save',campaign:d}),{status:409});
 await prepareNewsletterDeliveries(env);await prepareNewsletterDeliveries(env);assert.equal(sql.prepare('SELECT count(*) n FROM order_notifications').get().n,2);
 await newsletterPreferenceStatement(env,{id:'jp',email:'jp@example.test'},false).run();const sent=[];await drainNotifications(env,async(u,o)=>{sent.push(JSON.parse(o.body));return Response.json({id:'accepted'});});await drainNotifications(env,()=>{throw Error('duplicate');});
 assert.equal(sent.length,1);assert.deepEqual(sent[0].to,['tw@example.test']);assert.match(sent[0].html,/English/);assert.match(sent[0].text,/newsletter\/unsubscribe\?token=/);await prepareNewsletterDeliveries(env);assert.equal(sql.prepare('SELECT state FROM newsletter_campaigns').get().state,'finished');
 const result=await call(null,'?id='+d.id);assert.deepEqual(Object.fromEntries(result.counts.map(r=>[r.state,r.total])),{cancelled:1,sent:1});sql.close();
});
test('preview does not enroll its recipient; retries preserve payload and stop after uncertain window',async()=>{
 const {sql,env,call}=setup();let d=(await call({action:'save',campaign:{...blankNewsletter(),subject:'草稿',zh:'這是內容'}})).campaign;
 const req={action:'preview',id:d.id,email:'owner@example.test',key:'preview-key-123456'};await call(req);await call(req);await assert.rejects(call({...req,email:'different@example.test'}),{status:409});
 assert.equal(sql.prepare('SELECT count(*) n FROM newsletter_preferences').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM newsletter_recipients').get().n,0);
 const attempts=[];await drainNotifications(env,async(u,o)=>{attempts.push(o);throw Error('connection lost');});d=(await call({action:'save',campaign:{...d,zh:'修改後'}})).campaign;sql.exec('UPDATE order_notifications SET next_attempt=0');await drainNotifications(env,async(u,o)=>{attempts.push(o);return Response.json({id:'accepted'});});assert.equal(attempts[0].body,attempts[1].body);assert.equal(attempts[0].headers['Idempotency-Key'],attempts[1].headers['Idempotency-Key']);sql.close();
});
test('unsubscribe link GET cannot remove consent, POST is origin checked and isolated from annual preferences',async()=>{
 const {sql,env,addBuyer}=setup();await newsletterSchema(env);await addBuyer('tw');const p=sql.prepare('SELECT * FROM newsletter_preferences').get();const url='https://shop.test/newsletter/unsubscribe?token='+p.token;
 assert.equal((await newsletterUnsubscribe(new Request(url),env)).status,200);assert.equal(sql.prepare('SELECT enabled FROM newsletter_preferences').get().enabled,1);
 assert.equal((await newsletterUnsubscribe(new Request(url,{method:'POST',headers:{Origin:'https://evil.test'}}),env)).status,403);
 assert.equal((await worker.fetch(new Request(url,{method:'POST',headers:{Origin:'https://shop.test'}}),env)).status,200);assert.equal(sql.prepare('SELECT enabled FROM newsletter_preferences').get().enabled,0);
 assert.equal((await newsletterUnsubscribe(new Request('https://shop.test/newsletter/unsubscribe?token=bad'),env)).status,400);sql.close();
});
test('newsletter routes require admin/CSRF and member preferences affect only the authenticated account',async()=>{
 const {sql,env,addBuyer}=setup();await newsletterSchema(env);await addBuyer('owner');await addBuyer('other');
 const raw='a'.repeat(64),hash=createHash('sha256').update(raw).digest('hex');sql.prepare('INSERT INTO admin_members VALUES (?,1,?)').run('owner','2026');sql.prepare('INSERT INTO admin_sessions VALUES (?,?,?,?)').run(hash,'owner','hash',Math.floor(Date.now()/1000)+1000);sql.prepare('INSERT INTO member_sessions VALUES (?,?,?)').run(hash,'owner',Math.floor(Date.now()/1000)+1000);
 const fetchApi=async(path,method,data,cookie='',origin='https://shop.test')=>worker.fetch(new Request('https://shop.test'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}),env);
 assert.equal((await fetchApi('/api/admin/newsletters','GET')).status,403);
 assert.equal((await fetchApi('/api/admin/newsletters','GET',null,'__Host-wugong_session='+raw)).status,403);
 assert.equal((await fetchApi('/api/admin/newsletters','POST',{action:'save',campaign:{...blankNewsletter(),subject:'主旨',zh:'內容'}},'__Host-wugong_admin='+raw,'https://evil.test')).status,403);
 assert.equal((await fetchApi('/api/admin/newsletters','GET',null,'__Host-wugong_admin='+raw)).status,200);
 assert.equal((await fetchApi('/api/member/newsletter','POST',{enabled:false,member_id:'other'},'__Host-wugong_session='+raw)).status,200);
 assert.equal(sql.prepare("SELECT enabled FROM newsletter_preferences WHERE member_id='owner'").get().enabled,0);assert.equal(sql.prepare("SELECT enabled FROM newsletter_preferences WHERE member_id='other'").get().enabled,1);
 assert.equal((await fetchApi('/api/member/newsletter','POST',{enabled:'true'},'__Host-wugong_session='+raw)).status,400);sql.close();
});
test('registration requires email, defaults to no newsletter consent and records explicit consent only for the new account',async()=>{
 const {sql,env}=setup();delete env.RESEND_API_KEY;
 const register=async d=>worker.fetch(new Request('https://shop.test/api/member/register',{method:'POST',headers:{Origin:'https://shop.test','Content-Type':'application/json'},body:JSON.stringify(d)}),env);
 const base={email:'first@example.test',password:'long registration password',name:'Buyer',birthday:'1990-01-01',country:'TW'};
 assert.equal((await register({...base,email:''})).status,400);assert.equal((await register(base)).status,200);
 await newsletterSchema(env);assert.equal(sql.prepare('SELECT count(*) n FROM newsletter_preferences').get().n,0);
 assert.equal((await register({...base,email:'second@example.test',newsletterConsent:true})).status,200);
 const p=sql.prepare('SELECT * FROM newsletter_preferences').get();assert.equal(p.email,'second@example.test');assert.equal(p.enabled,1);
 assert.equal((await register({...base,newsletterConsent:true})).status,409);assert.equal(sql.prepare('SELECT count(*) n FROM newsletter_preferences').get().n,1);sql.close();
});
