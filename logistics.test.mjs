import test from 'node:test';
import assert from 'node:assert/strict';
import {logisticsMac,validLogisticsName,printLogistics} from './logistics.js';
test('logistics MD5 matches ECPay published vector (not payment SHA256)',()=>{
 const fields={MerchantID:'2000933',MerchantTradeNo:'A20130312153023',MerchantTradeDate:'2013/03/12 15:30:23',LogisticsType:'CVS',LogisticsSubType:'FAMIC2C',GoodsAmount:'1000',IsCollection:'N',ServerReplyURL:'https://www.ecpay.com.tw/ServerReplyURL',SenderName:'寄件者姓名',ReceiverName:'收件者姓名',ReceiverStoreID:'001779'};
 assert.equal(logisticsMac(fields,'XBERn1YOvpM9nfZc','h1ONHk4P4yqbl5LK'),'692FD6E2CDB539CCDB7206C76DC239AD');
 assert.equal(validLogisticsName('李宜青'),true);assert.equal(validLogisticsName('王小明😀'),false);assert.equal(validLogisticsName('太長的中文姓名'),false);
});
test('7-ELEVEN print has matching payment number and validation code',async()=>{
 const row={state:'created',merchant_id:'3442057',subtype:'UNIMARTC2C',logistics_id:'123456',payment_no:'12345678',validation_no:'9012'};
 const env={PAYMENTS_LIVE:'true',ECPAY_MERCHANT_ID:'3442057',ECPAY_LOGISTICS_HASH_KEY:'fixture-key',ECPAY_LOGISTICS_HASH_IV:'fixture-iv',DB:{prepare(){return {run:async()=>{},bind(){return this;},first:async()=>row};}}};
 const print=await printLogistics(env,'order');assert.equal(print.action,'https://logistics.ecpay.com.tw/Express/PrintUniMartC2COrderInfo');assert.equal(print.fields.CVSPaymentNo,'12345678');assert.equal(print.fields.CVSValidationNo,'9012');assert.equal(print.fields.PrintMode,'1');assert.equal(print.fields.CheckMacValue,logisticsMac(print.fields,'fixture-key','fixture-iv'));
 row.validation_no=null;await assert.rejects(printLogistics(env,'order'),/完整寄貨編號/);
});
