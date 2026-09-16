import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './worker.js';
function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE orders(id INTEGER PRIMARY KEY AUTOINCREMENT,order_number TEXT UNIQUE,customer_name TEXT,phone TEXT,email TEXT,address TEXT,shipping TEXT,payment TEXT,note TEXT,items TEXT,total REAL,status TEXT,created_at TEXT);');
 sql.exec(readFileSync(new URL('./schema-members.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('./schema-checkout.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('./schema-commerce.sql',import.meta.url),'utf8'));

 for(const file of ['schema-payments.sql','schema-checkout.sql','seed-inventory-staging.sql','seed-products.sql'])sql.exec(readFileSync(new URL('./'+file,import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('schema-modules.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('schema-categories-gifts.sql',import.meta.url),'utf8'));sql.exec("UPDATE product_families SET confirmed=1; UPDATE inventory SET available=5 WHERE sku LIKE 'body-%';");
 const prepare=(query)=>{let params=[];return{bind(...values){params=values;return this;},async first(){return sql.prepare(query).get(...params)||null;},async all(){return {results:sql.prepare(query).all(...params)};},async run(){const result=sql.prepare(query).run(...params);return{meta:{changes:result.changes}};}};};
 return{sql,prepare,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
test('bank checkout persists deadline, enforces ownership, and never marks reports paid',async()=>{
 const DB=database();DB.sql.exec(readFileSync(new URL('./schema-payments.sql',import.meta.url),'utf8'));
 const env={DB,APP_ENV:'staging',PAYMENT_ORIGIN:'https://wugong-test.wugong-pen.workers.dev',BANK_TEST_CONFIG:JSON.stringify({bank:'測試銀行',code:'TEST',branch:'測試分行',holder:'測試戶名',account:'TEST',days:3})};
 const call=async(path,data,cookie='')=>{const r=await worker.fetch(new Request('https://shop.test'+path,{method:'POST',headers:{Origin:'https://shop.test','Content-Type':'application/json',Cookie:cookie,'Idempotency-Key':'bank-test-order-0001'},body:JSON.stringify(data)}),env);return {status:r.status,headers:r.headers,...await r.json()};};
 const member=await call('/api/member/register',{email:'bank@example.test',password:'a long bank test password',name:'測試',birthday:'1990-01-01',country:'TW'});const cookie=member.headers.get('set-cookie').split(';')[0];
 const order=await call('/api/order',{customer:{name:'測試',phone:'000',address:'測試',country:'TW'},items:[{id:'pojun-單尖',nib:'單尖',quantity:1}],payment:'bank',expectedTotal:25000},cookie);assert.equal(order.success,true);
 const bank=await call('/api/payments/start',{orderNumber:order.orderNumber},cookie);assert.equal(bank.success,true,JSON.stringify(bank));assert.equal(bank.bank.account,'TEST');
 const created=DB.sql.prepare('SELECT created_at FROM orders').get().created_at;assert.equal(Date.parse(bank.dueAt)-Date.parse(created),3*86400000);
 assert.equal((await call('/api/payments/start',{orderNumber:order.orderNumber},cookie)).dueAt,bank.dueAt);
 assert.equal((await call('/api/payments/start',{orderNumber:order.orderNumber})).status,401);
 const other=await call('/api/member/register',{email:'other@example.test',password:'a long bank test password',name:'測試',birthday:'1990-01-01',country:'TW'});assert.equal((await call('/api/payments/start',{orderNumber:order.orderNumber},other.headers.get('set-cookie').split(';')[0])).status,404);
 const report={orderNumber:order.orderNumber,last5:'12345',date:new Date(Date.now()+8*3600000).toISOString().slice(0,10)};
 assert.equal((await call('/api/payments/bank/report',report,cookie)).success,true);
 assert.equal(DB.sql.prepare('SELECT status FROM orders').get().status,'pending');assert.equal(DB.sql.prepare('SELECT remittance_last5 FROM payment_attempts').get().remittance_last5,'12345');
 DB.sql.exec("UPDATE payment_attempts SET due_at='2000-01-01T00:00:00.000Z'");assert.equal((await call('/api/payments/bank/report',report,cookie)).status,409);
 DB.sql.close();
});
