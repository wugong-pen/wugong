import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {liveSchema,reportBank,confirmBank} from './live-payments.js';
import {reserveStatements} from './inventory.js';
import {buyerNotificationPayload} from './order-notifications.js';
import {checkMac,validLiveNotice,paymentForm,queryEcpay,notify} from './ecpay.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE orders(order_number TEXT PRIMARY KEY,total INTEGER,status TEXT,payment TEXT,items TEXT,email TEXT,created_at TEXT);CREATE TABLE admin_audit(id TEXT PRIMARY KEY,member_id TEXT,action TEXT,order_number TEXT,previous_status TEXT,next_status TEXT,created_at TEXT);');
 for(const f of ['schema-payments.sql','schema-checkout.sql','seed-inventory-staging.sql','schema-commerce.sql','schema-modules.sql','schema-categories-gifts.sql'])sql.exec(readFileSync(new URL(f,import.meta.url),'utf8'));
 const DB={prepare(q){let args=[];return{bind(...values){args=values;return this;},async first(){return sql.prepare(q).get(...args)||null;},async all(){return{results:sql.prepare(q).all(...args)};},async run(){return{meta:{changes:sql.prepare(q).run(...args).changes}};}};},async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,PAYMENTS_LIVE:'true',PAYMENT_ORIGIN:'https://shop.example',MAIL_ORIGIN:'https://shop.example',MAIL_FROM:'shop@example.test',ECPAY_MERCHANT_ID:'1234567',ECPAY_HASH_KEY:'private-fixture-key',ECPAY_HASH_IV:'private-fixture-iv'};
 async function order(number='WG1',payment='bank',live=true){await liveSchema(env);const o={order_number:number,total:120000,status:'pending',payment,items:JSON.stringify([{id:'product-fuji',product:'鋼筆',quantity:1}]),email:'buyer@example.test',created_at:new Date().toISOString()};await DB.batch([DB.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?)').bind(number,o.total,o.status,payment,o.items,o.email,o.created_at),...reserveStatements(env,number,JSON.parse(o.items),payment)]);if(live)await DB.prepare('INSERT INTO live_orders VALUES (?,?)').bind(number,o.created_at).run();if(payment==='bank'){await DB.prepare("UPDATE checkout_reservations SET state='paying' WHERE order_number=?").bind(number).run();await DB.prepare("INSERT INTO payment_attempts(order_number,provider,state,due_at) VALUES (?,'bank','fixture',?)").bind(number,new Date(Date.now()+86400000).toISOString()).run();}return o;}
 return{sql,env,order};
}
test('bank report notifies once without marking paid; confirmation settles once atomically',async()=>{
 const {sql,env,order}=setup();try{
  const o=await order(),data={last5:'12345',date:new Date(Date.now()+8*3600000).toISOString().slice(0,10)};
  await reportBank(env,o,data);await reportBank(env,o,data);
  assert.equal(sql.prepare('SELECT status FROM orders').get().status,'pending');assert.equal(sql.prepare('SELECT count(*) n FROM order_notifications').get().n,1);
  await assert.rejects(confirmBank(env,{id:'admin'},{orderNumber:'WG1',confirmed:true,amount:1,reference:'R001'}));
  await confirmBank(env,{id:'admin'},{orderNumber:'WG1',confirmed:true,amount:120000,reference:'R001'});
  await assert.rejects(confirmBank(env,{id:'admin'},{orderNumber:'WG1',confirmed:true,amount:120000,reference:'R001'}));
  assert.equal(sql.prepare('SELECT status FROM orders').get().status,'paid');assert.equal(sql.prepare("SELECT sold FROM inventory WHERE sku='product-fuji'").get().sold,1);assert.equal(sql.prepare('SELECT count(*) n FROM order_notifications').get().n,2);
  const second=await order('WG2');await assert.rejects(confirmBank(env,{id:'admin'},{orderNumber:second.order_number,confirmed:true,amount:120000,reference:'R001'}));assert.equal(sql.prepare("SELECT status FROM orders WHERE order_number='WG2'").get().status,'pending');
 }finally{sql.close();}
});
test('legacy orders and invalid calendar dates cannot produce live payment notifications',async()=>{
 const {sql,env,order}=setup();try{const o=await order('old','bank',false);await assert.rejects(reportBank(env,o,{last5:'12345',date:'2026-02-30'}));await assert.rejects(confirmBank(env,{id:'admin'},{orderNumber:'old',confirmed:true,amount:120000,reference:'R001'}));assert.equal(sql.prepare('SELECT count(*) n FROM payment_receipts').get().n,0);}finally{sql.close();}
});
test('bank confirmation email includes immutable bank snapshot and report link',()=>{
 const p=buyerNotificationPayload({MAIL_ORIGIN:'https://shop.example'},{order_number:'WG1',email:'buyer@example.test',items:[{product:'Pen',quantity:1}],total:100,payment:'bank',bank:{bank:'Bank',code:'009',branch:'Branch',holder:'Holder',account:'12345678'},dueAt:'2026-10-04T00:00:00Z'},'confirmed');
 assert.match(p.text,/12345678/);assert.match(p.text,/last five digits/);assert.match(p.text,/payment-return.html\?order=WG1/);assert.doesNotMatch(p.text,/測試|test payment/i);
});
test('live ECPay rejects tampering, wrong amount, merchant, method, simulations and public signature',()=>{
 const c={merchant:'1234567',key:'private-key',iv:'private-iv'},o={order_number:'WG1',total:100},a={merchant_id:c.merchant,payment_type:'Credit'};
 const data={MerchantID:c.merchant,MerchantTradeNo:'WG1',TradeAmt:'100',TradeNo:'12345',PaymentType:'Credit_CreditCard',SimulatePaid:'0',RtnCode:'1'};
 const signed=d=>({...d,CheckMacValue:checkMac(d,c.key,c.iv)});
 assert.equal(validLiveNotice(signed(data),o,a,c),true);
 for(const change of [{SimulatePaid:'1'},{TradeAmt:'1'},{MerchantID:'7654321'},{PaymentType:'TWQR_OPAY'},{MerchantTradeNo:'WG2'}])assert.equal(validLiveNotice(signed({...data,...change}),o,a,c),false);
 assert.equal(validLiveNotice({...signed(data),TradeAmt:'101'},o,a,c),false);
 assert.equal(validLiveNotice({...data,CheckMacValue:checkMac(data)},o,a,c),false);
});
test('live ECPay query settles stock and receipt email once; old orders cannot start',async()=>{
 const {sql,env,order}=setup();try{
 const o=await order('WG123456789012345678','ecpay');const form=await paymentForm(o,env);assert.equal(form.action,'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5');assert.equal(form.fields.ChoosePayment,'Credit');
 const data={MerchantID:env.ECPAY_MERCHANT_ID,MerchantTradeNo:o.order_number,TradeAmt:String(o.total),TradeNo:'123456789',PaymentType:'Credit_CreditCard',TradeStatus:'1'};data.CheckMacValue=checkMac(data,env.ECPAY_HASH_KEY,env.ECPAY_HASH_IV);
 const send=async url=>{assert.equal(url,'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5');return new Response(new URLSearchParams(data));};
 assert.equal(await queryEcpay(env,o,send),true);assert.equal(await queryEcpay(env,o,send),true);assert.equal(sql.prepare('SELECT status FROM orders').get().status,'paid');assert.equal(sql.prepare("SELECT sold FROM inventory WHERE sku='product-fuji'").get().sold,1);assert.equal(sql.prepare('SELECT count(*) n FROM order_notifications').get().n,1);
 await assert.rejects(paymentForm(await order('old','ecpay',false),env));
 }finally{sql.close();}
});

