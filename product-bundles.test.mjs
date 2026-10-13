import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {catalogQuote,catalogGuards} from './commerce.js';
import {bundleAvailability,bundleRecipes} from './product-bundles.js';
import {checkStock,reserveStatements,expireReservations,lockPayment,settlePayment} from './inventory.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE orders(order_number TEXT PRIMARY KEY,total INTEGER,status TEXT,payment TEXT,items TEXT)');
 for(const f of ['schema-payments.sql','schema-checkout.sql','schema-commerce.sql','schema-modules.sql','schema-categories-gifts.sql'])sql.exec(readFileSync(new URL(f,import.meta.url),'utf8'));
 const DB={prepare(q){let a=[];return{bind(...v){a=v;return this;},async first(){return sql.prepare(q).get(...a)||null;},async all(){return{results:sql.prepare(q).all(...a)};},async run(){return{meta:{changes:sql.prepare(q).run(...a).changes}};}};},async batch(ss){sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 for(const sku of new Set([...Object.keys(bundleRecipes),...Object.values(bundleRecipes).flat().map(p=>p.sku)])){
  sql.prepare('INSERT INTO inventory(sku,available) VALUES (?,0)').run(sku);
  sql.prepare('INSERT INTO inventory(sku,available) VALUES (?,?)').run('body-'+sku,bundleRecipes[sku]?0:20);
  sql.prepare('INSERT INTO products(sku,family,name,variant,category,price,active,updated_at) VALUES (?,?,?,?,?,?,1,?)').run(sku,sku,sku,sku,'craft',sku.includes('-mix-')?588:sku==='change-mug-pair'?1200:350,'now');
  sql.prepare('INSERT INTO product_families(family,stock_sku,confirmed) VALUES (?,?,1)').run(sku,'body-'+sku);
 }
 const env={DB},quote=(id,quantity=1,extra={})=>catalogQuote(env,[{id,nib:id,quantity,...extra}]);
 const reserve=async(number,q)=>DB.batch([DB.prepare('INSERT INTO orders VALUES (?,?,?,?,?)').bind(number,q.total,'pending','bank',JSON.stringify(q.items)),...catalogGuards(env,q.items),...reserveStatements(env,number,q.items,'bank')]);
 const stock=sku=>sql.prepare('SELECT available,sold FROM inventory WHERE sku=?').get('body-'+sku);
 return {sql,env,quote,reserve,stock};
}
test('server resolves both selected colours and ignores forged stock/price fields',async()=>{
 const {quote}=setup();const q=await quote('change-tr-mix-blue-pine',2,{price:1,stockComponents:[{stockId:'fake',units:0}]});
 assert.equal(q.total,1176);assert.deepEqual(q.items[0].stockComponents.map(p=>[p.stockId,p.units]),[['body-change-tr-large-blue',1],['body-change-tr-small-pine',1]]);
});
test('bundle and single share stock; failed overlapping reservation rolls back all components',async()=>{
 const {env,quote,reserve,stock}=setup();const a=await quote('change-tr-small-three',19),b=await quote('change-tr-small-amber',2),q={items:[...a.items,...b.items],total:a.total+b.total};
 await assert.rejects(checkStock(env,q.items),/庫存不足/);await assert.rejects(reserve('too-many',q),/CHECK/);
 assert.equal(stock('change-tr-small-blue').available,20);assert.equal(stock('change-tr-small-amber').available,20);
 await reserve('ok',await quote('change-tr-small-three',2));assert.equal(stock('change-tr-small-amber').available,18);assert.equal(stock('change-tr-small-pine').available,18);assert.equal(stock('change-tr-small-blue').available,18);
});
test('mug pairs consume two, expire once, and settled stock counts actual mugs once',async()=>{
 const {sql,env,quote,reserve,stock}=setup();sql.prepare('UPDATE inventory SET available=10 WHERE sku=?').run('body-change-mug-single');
 assert.equal((await bundleAvailability(env,{sku:'change-mug-pair'})).available,5);
 const q=await quote('change-mug-pair',2);await reserve('expires',q);assert.equal(stock('change-mug-single').available,6);
 sql.exec("UPDATE checkout_reservations SET expires_at='2000-01-01'");await expireReservations(env);await expireReservations(env);assert.equal(stock('change-mug-single').available,10);
 await reserve('paid',q);await lockPayment(env,'paid');const order={order_number:'paid',total:q.total};await settlePayment(env,order,'bank','receipt');await settlePayment(env,order,'bank','receipt');assert.equal(stock('change-mug-single').available,6);assert.equal(stock('change-mug-single').sold,4);
});
test('deactivated components stop sales and concurrent component changes roll back checkout',async()=>{
 const {sql,env,quote,reserve,stock}=setup();const q=await quote('change-tr-large-three');sql.exec("UPDATE products SET active=0,version=version+1 WHERE sku='change-tr-large-blue'");
 assert.equal((await bundleAvailability(env,{sku:'change-tr-large-three'})).available,0);await assert.rejects(quote('change-tr-large-three'),/暫時無法/);await assert.rejects(reserve('stale',q),/CHECK/);assert.equal(stock('change-tr-large-amber').available,20);
});
