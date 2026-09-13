import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {checkMac,quote,paymentForm,notify} from './ecpay.js';
test('catalog rejects unknown items and uses server prices for each nib',()=>{
 assert.equal(quote([{id:'pojun-雙層特殊尖',nib:'雙層特殊尖',price:1,quantity:2}]).total,59000);
 assert.throws(()=>quote([{id:'missing',nib:'單尖',quantity:1}]));
 assert.throws(()=>quote([{id:'pojun-單尖',nib:'雙層特殊尖',quantity:1}]));
 assert.throws(()=>quote([{id:'pojun-單尖',nib:'單尖',quantity:-1}]));
});
test('public shared sandbox signatures cannot mark orders paid',async()=>{
 const p={MerchantID:'3002607',MerchantTradeNo:'WG0123456789abcdef01',TradeAmt:'25000',RtnCode:'1',SimulatePaid:'0',TradeNo:'123456',PaymentType:'Credit_CreditCard'};
 const env={APP_ENV:'staging',DB:{prepare(){throw new Error('Must not touch orders');}}};
 const response=await notify(new Request('https://shop.test/api/payments/ecpay/notify',{method:'POST',body:new URLSearchParams({...p,CheckMacValue:checkMac(p)})}),env);
 assert.equal(response.status,503);assert.throws(()=>paymentForm({},env));
});
