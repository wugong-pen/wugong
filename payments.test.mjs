import test from 'node:test';
import assert from 'node:assert/strict';
import {methods,bankConfig,lineSignature,parseLine,validRedirect,paypalPaid,paypalApproved,start} from './payments.js';
import {createHmac} from 'node:crypto';
test('payment availability fails closed and follows delivery country',()=>{
 const env={APP_ENV:'staging',LINEPAY_SANDBOX_CHANNEL_ID:'id',LINEPAY_SANDBOX_CHANNEL_SECRET:'secret',PAYPAL_SANDBOX_CLIENT_ID:'id',PAYPAL_SANDBOX_CLIENT_SECRET:'secret'};
 assert.equal(methods(env,'TW').paypal,false);assert.equal(methods(env,'JP').linepay,false);assert.equal(methods(env,'JP').paypal,true);assert.equal(methods(env,'FR').paypal,true);assert.equal(methods(env,'HK').paypal,true);assert.equal(methods(env,'XX').paypal,false);assert.equal(methods({...env,APP_ENV:'production'},'TW').linepay,false);assert.equal(methods({},'TW').bank,false);
});
test('LINE signature includes exact JSON and large transaction IDs remain exact',()=>{
 assert.equal(lineSignature('s','/path','{}','n'),createHmac('sha256','s').update('s/path{}n').digest('base64'));
 assert.equal(parseLine('{"info":{"transactionId":2023042201206549310}}').info.transactionId,'2023042201206549310');
});
test('provider redirect cannot escape sandbox',()=>{
 assert.equal(validRedirect('paypal','https://www.sandbox.paypal.com/checkout'),true);for(const u of ['https://www.paypal.com/checkout','https://www.sandbox.paypal.com.evil.test','https://x@www.sandbox.paypal.com','javascript:alert(1)'])assert.equal(validRedirect('paypal',u),false);
});
test('PayPal paid requires completed capture, order, and TWD amount',()=>{
 const order={order_number:'WG1',total:25000},result={id:'P1',status:'COMPLETED',purchase_units:[{reference_id:'WG1',custom_id:'WG1',payments:{captures:[{id:'CAPTURE1',status:'COMPLETED',amount:{currency_code:'TWD',value:'25000'},final_capture:true}]}}]};
 assert.equal(paypalPaid(result,order,'P1'),true);
 for(const mutate of [r=>r.status='APPROVED',r=>r.purchase_units[0].custom_id='other',r=>r.purchase_units[0].payments.captures[0].amount.currency_code='USD',r=>r.purchase_units[0].payments.captures[0].amount.value='1',r=>r.purchase_units[0].payments.captures[0].status='PENDING']){const r=structuredClone(result);mutate(r);assert.equal(paypalPaid(r,order,'P1'),false);}
});
test('PayPal capture response carries custom_id on capture; conflicting or missing IDs fail',()=>{
 const order={order_number:'WG1',total:25000},result={id:'P1',status:'COMPLETED',purchase_units:[{reference_id:'WG1',payments:{captures:[{id:'CAPTURE1',custom_id:'WG1',status:'COMPLETED',amount:{currency_code:'TWD',value:'25000.00'},final_capture:true}]}}]};
 assert.equal(paypalPaid(result,order,'P1'),true);
 result.purchase_units[0].custom_id='other';assert.equal(paypalPaid(result,order,'P1'),false);
 delete result.purchase_units[0].custom_id;delete result.purchase_units[0].payments.captures[0].custom_id;assert.equal(paypalPaid(result,order,'P1'),false);
});
test('bank config requires account and bounded payment deadline',()=>{
 assert.equal(bankConfig({BANK_TEST_CONFIG:'{}'}),null);assert.equal(bankConfig({BANK_TEST_CONFIG:'bad'}),null);
});
test('production cannot initiate provider payments',async()=>{await assert.rejects(start({payment:'paypal'},{APP_ENV:'production'}),/正式付款尚未開放/);});
test('PayPal approval must match the stored order before capture',()=>{
 const order={order_number:'WG1',total:120000},r={id:'PAY1',intent:'CAPTURE',status:'APPROVED',purchase_units:[{reference_id:'WG1',custom_id:'WG1',amount:{currency_code:'TWD',value:'120000.00'}}]};
 assert.equal(paypalApproved(r,order,'PAY1'),true);
 for(const change of [r=>r.id='OTHER',r=>r.intent='AUTHORIZE',r=>r.purchase_units[0].custom_id='OTHER',r=>r.purchase_units[0].amount.value='1',r=>r.purchase_units[0].amount.value='12e4',r=>r.purchase_units[0].amount.currency_code='USD']){const bad=structuredClone(r);change(bad);assert.equal(paypalApproved(bad,order,'PAY1'),false);}
 assert.equal(methods({APP_ENV:'staging',LINEPAY_SANDBOX_CHANNEL_ID:'id',LINEPAY_SANDBOX_CHANNEL_SECRET:'secret'},'TW').linepay,false);
 assert.equal(methods({APP_ENV:'staging'},'TW').ecpay,false);
});
