// Sandbox only. Public credentials from https://developers.ecpay.com.tw/2856/
import { createHash, timingSafeEqual } from 'node:crypto';
export const ENDPOINT='https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';
const merchant='3002607', key='pwFHCqoQZGmho4w6', iv='EkRm7iFT261dpevs';
export function checkMac(params) {
  const keys=Object.keys(params).filter(k=>k!=='CheckMacValue').sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:a.toLowerCase()>b.toLowerCase()?1:0);
  const raw=`HashKey=${key}&${keys.map(k=>`${k}=${params[k]}`).join('&')}&HashIV=${iv}`;
  const encoded=encodeURIComponent(raw).replace(/%20/g,'+').replace(/%2D/gi,'-').replace(/%5F/gi,'_').replace(/%2E/gi,'.').replace(/%21/gi,'!').replace(/%2A/gi,'*').replace(/%28/gi,'(').replace(/%29/gi,')').replace(/'/g,'%27').toLowerCase();
  return createHash('sha256').update(encoded).digest('hex').toUpperCase();
}
const abort=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function sandbox(env){if(env.APP_ENV!=='staging')abort(503,'正式付款尚未開放');}
const catalog=new Map();
for(const [id,product,price] of [['egypt','神秘之境・永晝之塔',150000],['fuji','靈峰之心・富士山',120000],['huangshan','煙雲畫境・黃山',120000],['lushan','匡盧聖境・廬山',120000]])catalog.set(`product-${id}`,{product,variants:{'WUGONG 筆尖':price}});
for(const [prefix,product,variants] of [['pojun-','四面楚歌・破軍',{'單尖':25000,'偃月刀尖':25000,'雙層特殊尖':29500,'逆雙層特殊尖':29500}],['sihuang-brass-','四皇・繫世（黃銅款）',{'單尖':13500,'雙層特殊尖':18000,'逆雙層特殊尖':18000}]])for(const nib of Object.keys(variants))catalog.set(prefix+nib,{product,variants:{[nib]:variants[nib]}});
export function quote(items){
  if(!Array.isArray(items)||!items.length||items.length>50)abort(400,'請確認購物車商品');
  const quantities=new Map();
  const result=items.map(item=>{
    if(!item||typeof item!=='object')abort(400,'請確認購物車商品');
    const entry=catalog.get(item.id),price=entry&&Object.hasOwn(entry.variants,item.nib)?entry.variants[item.nib]:undefined;
    if(!price)abort(400,'商品或筆尖規格已變更，請重新加入購物車');
    if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99)abort(400,'請確認商品數量');
    const count=(quantities.get(item.id)||0)+item.quantity;quantities.set(item.id,count);if(count>99)abort(400,'單項商品數量不能超過 99');
    return{id:item.id,product:entry.product,nib:item.nib,price,quantity:item.quantity};
  });
  return {items:result,total:result.reduce((sum,i)=>sum+i.price*i.quantity,0),shippingFee:0,currency:'TWD'};
}
export function paymentForm(){abort(503,'信用卡測試付款暫停，請使用銀行匯款或海外 PayPal 測試');}
export async function notify(){return new Response('0|Payment integration disabled',{status:503});}
