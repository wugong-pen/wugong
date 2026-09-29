import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from './worker.js';
import {annualUnsubscribe,newYearSchema,newYearPayload,queueNewYearGreetings,queueNewYearPreview,drainNotifications,notificationStatus} from './order-notifications.js';

function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE members(id TEXT PRIMARY KEY,email TEXT,active INTEGER);CREATE TABLE member_orders(order_number TEXT,member_id TEXT);CREATE TABLE orders(order_number TEXT PRIMARY KEY,status TEXT,created_at TEXT);CREATE TABLE admin_audit(order_number TEXT,previous_status TEXT,next_status TEXT)');
 const DB={prepare(q){let args=[];return {bind(...values){args=values;return this;},async first(){return sql.prepare(q).get(...args)||null;},async all(){return {results:sql.prepare(q).all(...args)};},async run(){return {meta:{changes:sql.prepare(q).run(...args).changes}};}};},async batch(ss){for(const s of ss)await s.run();}};
 const env={DB,APP_ENV:'production',RESEND_API_KEY:'fake',MAIL_FROM:'WUGONG <noreply@example.test>',MAIL_ORIGIN:'https://shop.example.test'};
 const buyer=(id,email,status='completed',active=1,created='2026-12-01T00:00:00.000Z')=>{sql.prepare('INSERT INTO members VALUES (?,?,?)').run(id,email,active);sql.prepare('INSERT INTO orders VALUES (?,?,?)').run(id,status,created);sql.prepare('INSERT INTO member_orders VALUES (?,?)').run(id,id);};
 return {sql,env,buyer};
}
const start=Date.parse('2027-01-01T01:00:00Z');
test('annual greetings use Taipei January 1 at 9am, deduplicate email/year and recur the next year',async()=>{
 const {sql,env,buyer}=setup();buyer('A','Buyer@Example.test');buyer('B','buyer@example.test','shipped');
 for(const time of ['2026-12-31T15:59:59Z','2026-12-31T16:00:00Z','2027-01-01T00:59:59Z','2027-01-01T16:00:00Z'])await queueNewYearGreetings(env,Date.parse(time));
 assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE name='order_notifications'").get().n,0);
 await queueNewYearGreetings(env,start);await queueNewYearGreetings(env,start+300000);
 let rows=sql.prepare('SELECT * FROM order_notifications').all();assert.equal(rows.length,1);assert.deepEqual(JSON.parse(rows[0].payload).to,['buyer@example.test']);assert.match(rows[0].id,/^buyer-newyear\/2027\//);
 await queueNewYearGreetings(env,Date.parse('2028-01-01T01:00:00Z'));assert.equal(sql.prepare('SELECT count(*) n FROM order_notifications').get().n,2);
 assert.equal((await notificationStatus(env)).notifications[0].kind,'buyer_newyear');sql.close();
});
test('only past shipped/completed purchases for active members qualify; simulated and unpaid orders do not',async()=>{
 const {sql,env,buyer}=setup();buyer('good','good@example.test');buyer('inactive','inactive@example.test','completed',0);buyer('pending','pending@example.test','pending');buyer('cancelled','cancel@example.test','cancelled');buyer('new','new@example.test','shipped',1,'2026-12-31T16:00:00.000Z');buyer('simulated','sim@example.test','completed');sql.exec("INSERT INTO admin_audit VALUES ('simulated','test_paid','shipped')");
 await queueNewYearGreetings(env,start);const rows=sql.prepare('SELECT payload FROM order_notifications').all();assert.equal(rows.length,1);assert.deepEqual(JSON.parse(rows[0].payload).to,['good@example.test']);sql.close();
});
test('large buyer lists continue across bounded cron batches without losing or duplicating recipients',async()=>{
 const {sql,env,buyer}=setup();for(let i=0;i<105;i++)buyer('B'+i,`buyer${i}@example.test`);
 await queueNewYearGreetings(env,start);await queueNewYearGreetings(env,start+300000);await queueNewYearGreetings(env,start+600000);
 assert.equal(sql.prepare('SELECT count(*) n FROM order_notifications').get().n,105);sql.close();
});
test('unsubscribe requires confirmation and suppresses queued and future greetings, not transaction emails',async()=>{
 const {sql,env,buyer}=setup();buyer('A','a@example.test');buyer('B','b@example.test');await queueNewYearGreetings(env,start);
 const {token}=sql.prepare("SELECT token FROM annual_greeting_preferences WHERE email='a@example.test'").get(),url=env.MAIL_ORIGIN+'/annual-greetings/unsubscribe?token='+token;
 assert.equal((await annualUnsubscribe(new Request(url),env)).status,200);assert.equal(sql.prepare('SELECT enabled FROM annual_greeting_preferences WHERE token=?').get(token).enabled,1);
 assert.equal((await annualUnsubscribe(new Request(url,{method:'POST',headers:{Origin:'https://evil.test'}}),env)).status,403);
 const r=await worker.fetch(new Request(url,{method:'POST',headers:{Origin:env.MAIL_ORIGIN}}),env);assert.equal(r.status,200);assert.match(await r.text(),/已停止年度問候/);
 sql.exec("UPDATE orders SET status='cancelled' WHERE order_number='B'");let calls=0;await drainNotifications(env,async()=>{calls++;return Response.json({id:'receipt'});});assert.equal(calls,0);assert.equal(sql.prepare("SELECT count(*) n FROM order_notifications WHERE state='cancelled'").get().n,2);
 await queueNewYearGreetings(env,Date.parse('2028-01-01T01:00:00Z'));assert.equal(sql.prepare('SELECT count(*) n FROM order_notifications').get().n,2);
 assert.equal((await annualUnsubscribe(new Request(env.MAIL_ORIGIN+'/annual-greetings/unsubscribe?token=bad'),env)).status,400);sql.close();
});
test('scheduled worker queues and delivers once, and new year previews do not enroll or create orders',async t=>{
 const {sql,env,buyer}=setup();buyer('A','buyer@example.test');t.mock.method(Date,'now',()=>start);
 const sent=[];t.mock.method(globalThis,'fetch',async(u,o)=>{sent.push(JSON.parse(o.body));return Response.json({id:'receipt-'+sent.length});});
 await worker.scheduled({},env);await worker.scheduled({},env);assert.equal(sent.length,1);assert.match(sent[0].subject,/2027/);
 await queueNewYearPreview(env,'preview@example.test','preview-request-001','admin');await queueNewYearPreview(env,'preview@example.test','preview-request-001','admin');await drainNotifications(env);
 assert.equal(sent.length,2);assert.deepEqual(sent[1].to,['preview@example.test']);assert.match(sent[1].subject,/內容預覽/);assert.ok(!sent[1].text.includes('?token='));assert.equal(sql.prepare('SELECT count(*) n FROM annual_greeting_preferences').get().n,1);assert.equal(sql.prepare('SELECT count(*) n FROM orders').get().n,1);
 await assert.rejects(queueNewYearPreview(env,'other@example.test','preview-request-001','admin'),{status:409});sql.close();
});
test('greeting is formal bilingual care with no test words or renewed warranty/free-service promises',()=>{
 const {env,sql}=setup();const p=newYearPayload(env,'buyer@example.test',2027,'a'.repeat(32));assert.equal(p.reply_to,'wugong.pen@gmail.com');
 for(const word of ['新年快樂','Happy New Year','刮紙','出墨不順','停止年度問候','Unsubscribe'])assert.ok((p.subject+p.text).includes(word));assert.ok(!/測試|TEST|免費|保固一年/.test(p.text+p.subject));assert.match(p.text,/2027/);sql.close();
});
