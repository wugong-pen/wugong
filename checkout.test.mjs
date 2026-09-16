import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {reserveStatements,lockPayment,settlePayment,expireReservations} from './inventory.js';
import {confirm,reconcilePayments} from './payments.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE orders(order_number TEXT PRIMARY KEY,total INTEGER,status TEXT,payment TEXT,items TEXT);');
 for(const name of ['schema-payments.sql','schema-checkout.sql','seed-inventory-staging.sql','schema-commerce.sql','schema-modules.sql','schema-categories-gifts.sql'])sql.exec(readFileSync(new URL(name,import.meta.url),'utf8'));
 const DB={prepare(q){let a=[];return{bind(...v){a=v;return this;},async first(){return sql.prepare(q).get(...a)||null;},async all(){return{results:sql.prepare(q).all(...a)};},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,APP_ENV:'staging',PAYPAL_SANDBOX_CLIENT_ID:'test',PAYPAL_SANDBOX_CLIENT_SECRET:'test'};
 const item={id:'product-fuji',quantity:1};
 const create=async(number,items=[item],payment='paypal')=>{const order={order_number:number,total:120000,status:'pending',payment};await DB.batch([DB.prepare('INSERT INTO orders VALUES (?,?,?,?,?)').bind(number,order.total,'pending',payment,JSON.stringify(items)),...reserveStatements(env,number,items,payment)]);return order;};
 const stock=()=>({...sql.prepare("SELECT available,sold FROM inventory WHERE sku='product-fuji'").get()});
 return{sql,env,create,stock};
}
test('stock reservation is atomic across multiple items and duplicate SKU lines',async()=>{
 const {sql,env,create,stock}=setup();
 await assert.rejects(create('bad',[{id:'product-fuji',quantity:2},{id:'product-egypt',quantity:6}]),/CHECK constraint failed: quantity/);
 assert.deepEqual(stock(),{available:5,sold:0});assert.equal(sql.prepare('SELECT count(*) n FROM orders').get().n,0);
 await create('ok',[{id:'product-fuji',quantity:2},{id:'product-fuji',quantity:3}]);assert.deepEqual(stock(),{available:0,sold:0});
 await assert.rejects(create('oversell'),/CHECK constraint failed: quantity/);assert.equal(sql.prepare('SELECT count(*) n FROM orders').get().n,1);
 sql.exec(readFileSync(new URL('seed-inventory-staging.sql',import.meta.url),'utf8'));assert.equal(stock().available,0);
 sql.close();
});
test('settlement records a unique receipt and deducts once; transaction reuse rolls back',async()=>{
 const {sql,env,create,stock}=setup(),order=await create('A');await lockPayment(env,'A');
 await settlePayment(env,order,'paypal','CAP1');await settlePayment(env,order,'paypal','CAP1');
 assert.deepEqual(stock(),{available:4,sold:1});assert.equal(sql.prepare('SELECT status FROM orders').get().status,'test_paid');
 const second=await create('B');await lockPayment(env,'B');await assert.rejects(settlePayment(env,second,'paypal','CAP1'),/UNIQUE/);
 assert.deepEqual(stock(),{available:3,sold:1});assert.equal(sql.prepare("SELECT state FROM checkout_reservations WHERE order_number='B'").get().state,'paying');
 sql.close();
});
test('held orders expire once, online uncertain payments retain stock, reported banks retain stock',async()=>{
 const {sql,env,create,stock}=setup();await create('held');await create('online');await lockPayment(env,'online');
 await create('bank',undefined,'bank');await lockPayment(env,'bank');await create('reported',undefined,'bank');await lockPayment(env,'reported');
 sql.exec("INSERT INTO payment_attempts(order_number,provider,state,reported_at) VALUES ('reported','bank','s','2026-01-01');UPDATE checkout_reservations SET expires_at='2000-01-01';");
 await expireReservations(env);await expireReservations(env);
 assert.deepEqual(stock(),{available:3,sold:0});assert.equal(sql.prepare("SELECT status FROM orders WHERE order_number='held'").get().status,'expired');
 await assert.rejects(lockPayment(env,'held'),/失效/);await assert.rejects(lockPayment(env,'legacy'),/失效/);
 assert.equal(sql.prepare("SELECT state FROM checkout_reservations WHERE order_number='online'").get().state,'paying');
 sql.close();
});
test('provider verification rejects wrong amounts and tokens; polling recovers interrupted successful capture',async t=>{
 const {sql,env,create,stock}=setup(),order=await create('A');await lockPayment(env,'A');
 sql.exec("INSERT INTO payment_attempts(order_number,provider,state,provider_id) VALUES ('A','paypal','STATE','PAY1')");
 let amount='1',calls=0;
 t.mock.method(globalThis,'fetch',async url=>{calls++;return Response.json(url.endsWith('/token')?{access_token:'test'}:{id:'PAY1',status:'COMPLETED',purchase_units:[{reference_id:'A',custom_id:'A',payments:{captures:[{id:'CAP1',status:'COMPLETED',amount:{currency_code:'TWD',value:amount},final_capture:true}]}}]});});
 await assert.rejects(confirm(order,env,{state:'wrong',token:'PAY1'}),/驗證/);assert.equal(calls,0);
 await assert.rejects(confirm(order,env,{state:'STATE',token:'OTHER'}),/交易/);assert.equal(calls,0);
 await assert.rejects(confirm(order,env,{state:'STATE',token:'PAY1'}),/尚未確認/);assert.deepEqual(stock(),{available:4,sold:0});
 amount='120000';await reconcilePayments(env);await reconcilePayments(env);
 assert.deepEqual(stock(),{available:4,sold:1});assert.equal(sql.prepare('SELECT count(*) n FROM payment_receipts').get().n,1);
 sql.close();
});
