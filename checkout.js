import {countryOptions} from './countries.js';
const $=id=>document.getElementById(id);
let member=null,busy=false,expectedTotal=null,pendingOrder=null,pendingPayment=null;
let couponCode='',firstCouponCode='',shippingReady=false,quoteSequence=0;
function applyQuote(d){shippingReady=d.shippingReady===true;expectedTotal=shippingReady?d.total:null;$('subtotal').textContent='NT$'+d.subtotal.toLocaleString();$('total').textContent=shippingReady?'NT$'+d.total.toLocaleString():'待確認運費';$('shippingSummary').textContent=shippingReady?'運費：NT$'+d.shippingFee.toLocaleString():d.shippingMessage;showFirstGift(d.firstGift);}
const requestKey=crypto.randomUUID();
const message=$('checkoutMessage');
function show(value){message.textContent=value;}
function cart(){try{return JSON.parse(localStorage.getItem('wugongCart'))||[];}catch{return[];}}
function render(){const items=cart();$('orderItems').replaceChildren();if(!items.length){show('購物車目前沒有商品。');return;}
  let total=0;for(const item of items){const row=document.createElement('div');row.className='order-item';const image=document.createElement('img');image.alt='';if(/^(?:\/media\/[a-f0-9]{64}|\/?[\w.-]+\.(?:jpe?g|png|webp))$/i.test(item.image||''))image.src=item.image;const label=document.createElement('div');label.textContent=`${item.product}${item.nib?' · '+item.nib:''} × ${item.quantity}`;const cost=document.createElement('div');const value=Number(item.price)*Number(item.quantity);cost.textContent=`NT$${value.toLocaleString()}`;total+=value;row.append(image,label,cost);$('orderItems').append(row);}$('subtotal').textContent=$('total').textContent=`NT$${total.toLocaleString()}`;
}

const couponPanel=document.createElement('div');couponPanel.innerHTML='<label for="checkoutCoupon">優惠券折扣碼</label><input id="checkoutCoupon" maxlength="40"><label for="firstCoupon">首購券代碼（選填）</label><input id="firstCoupon" maxlength="40"><button type="button" id="applyCoupon">套用／清除優惠券</button><p id="couponSummary"></p><p id="firstGiftSummary" role="status"></p><p>首購贈品每位會員、每支收件電話限一次；未完成訂單會先保留資格，取消後恢復。如贈品送完，將以其他贈品替代。海外替代贈品不含墨水。</p><p>一般優惠券：輸入折扣碼後按套用，每張訂單限一張。可同時使用一張一般優惠券與一張首購券，每位會員每券限一次，首購優惠合計也限一次。指定首購券會取代自動首購贈品；留空則依收件國家使用預設贈品。</p>';
$('orderItems').after(couponPanel);const shippingSummary=document.createElement('p');shippingSummary.id='shippingSummary';shippingSummary.setAttribute('role','status');couponPanel.after(shippingSummary);
$('applyCoupon').onclick=async()=>{
 if(busy||pendingOrder)return;busy=true;shippingReady=false;const seq=++quoteSequence;$('submitOrder').disabled=true;$('applyCoupon').disabled=true;
 try{const r=await fetch('/api/checkout/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:cart(),coupon:$('checkoutCoupon').value.trim(),firstCoupon:$('firstCoupon').value.trim(),country:$('country').value,phone:$('phone').value})}),d=await r.json();if(seq!==quoteSequence)return;if(!r.ok)throw Error(d.error);couponCode=d.coupon||'';firstCouponCode=d.firstGift?.code||'';applyQuote(d);$('couponSummary').textContent=couponCode?'已套用 '+couponCode+'，折抵 NT$'+d.discount.toLocaleString()+(d.gift?'；贈送商品：'+d.gift:''):'未使用優惠券';showFirstGift(d.firstGift);show('結帳金額已更新。');}catch(e){show(e.message);}finally{busy=false;$('applyCoupon').disabled=false;await updateMethods();}
};

render();$('submitOrder').disabled=true;
async function initialize(){try{const result=await(await fetch('/api/member',{cache:'no-store'})).json();if(!result.success)throw new Error();if(!result.member){location.replace('/member.html?next=checkout');return;}member=result.member;const regions=await(await fetch('/api/shipping')).json();if(!regions.success)throw Error(regions.error);countryOptions($('country'),'',regions.regions.map(r=>r.country));for(const key of ['name','phone','email','address','country'])$(key).value=member[key]||'';$('email').readOnly=true;const q=await(await fetch('/api/checkout/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:cart(),country:$('country').value,phone:$('phone').value})})).json();if(!q.success)throw new Error(q.error);localStorage.setItem('wugongCart',JSON.stringify(q.items.map(i=>({...i,image:cart().find(old=>old.id===i.id&&old.nib===i.nib)?.image}))));render();applyQuote(q);await updateMethods();show(`目前登入：${member.email}`);}catch(e){show(e.message||'無法確認登入狀態，請重新整理後再試。');}}
$('submitOrder').addEventListener('click',async()=>{
  if(busy||!member||(!pendingOrder&&!shippingReady))return;
  if(pendingOrder){busy=true;try{await startPayment(pendingOrder);}catch(e){show(e.message);}finally{busy=false;}return;}
  for(const key of ['name','phone','email','country','address']){if(!$(key).reportValidity())return;}
  const items=cart();if(!items.length){show('請先將商品加入購物車。');return;}
  busy=true;$('submitOrder').disabled=true;show('正在送出訂單…');
  try{const order={customer:{name:$('name').value,phone:$('phone').value,address:$('address').value,country:$('country').value},shipping:$('shipping').value,payment:document.querySelector('input[name=payment]:checked').value,note:$('note').value,items,expectedTotal,coupon:couponCode,firstCoupon:firstCouponCode};
    const response=await fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestKey},body:JSON.stringify(order)});const result=await response.json();
    if(response.status===401){location.assign('/member.html?next=checkout');return;}
    if(!response.ok||!result.success)throw new Error(result.error||'訂單送出失敗');
    pendingOrder=result.orderNumber;pendingPayment=order.payment;show('訂單已建立，正在準備付款…');await startPayment(pendingOrder);
  }catch(error){show(error.message||'連線失敗，請稍後再試。');}finally{busy=false;$('submitOrder').disabled=!pendingOrder&&!shippingReady;}
});
window.addEventListener('pageshow',event=>{if(event.persisted)initialize();});initialize();

async function updateMethods(){
 $('submitOrder').disabled=true;
 const country=$('country').value,seq=quoteSequence;const r=await fetch('/api/payments/methods?country='+encodeURIComponent(country));const data=await r.json();if(seq!==quoteSequence||country!==$('country').value)return;
 if(!r.ok||!data.success)throw new Error(data.error||'無法載入付款方式');
 const inputs=[...document.querySelectorAll('input[name=payment]')];
 for(const input of inputs){input.disabled=!data.methods[input.value];if(input.disabled)input.checked=false;}
 if(!inputs.some(i=>i.checked)) {const first=inputs.find(i=>!i.disabled);if(first)first.checked=true;}
 $('submitOrder').disabled=busy||!shippingReady||!inputs.some(i=>i.checked);
 if(!shippingReady)show('請確認收件地區及運費。');else if(!inputs.some(i=>i.checked))show('此收件國家的付款方式尚未設定完成。');
}
function showFirstGift(gift){$('firstGiftSummary').textContent=gift?(gift.code?'已套用首購券 '+gift.code+'｜':'已自動套用 ')+gift.title+'：'+gift.description:'此訂單目前無適用的首購贈品。';}
async function refreshFirstGift(){if(pendingOrder)return;const seq=++quoteSequence;shippingReady=false;expectedTotal=null;$('submitOrder').disabled=true;try{const r=await fetch('/api/checkout/quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:cart(),coupon:couponCode,firstCoupon:firstCouponCode,country:$('country').value,phone:$('phone').value})}),d=await r.json();if(seq!==quoteSequence)return;if(!r.ok)throw Error(d.error);applyQuote(d);await updateMethods();}catch(e){if(seq!==quoteSequence)return;$('firstGiftSummary').textContent='請確認收件國家與優惠券後重新套用。';show(e.message);}}
$('country').addEventListener('change',refreshFirstGift);
$('phone').addEventListener('change',refreshFirstGift);
async function startPayment(orderNumber){
 if(pendingPayment!=='ecpay'){
  const r=await fetch('/api/payments/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderNumber})});const data=await r.json();
  if(!r.ok||!data.success)throw new Error(data.error||'無法開始付款');
  if(data.bank){localStorage.removeItem('wugongCart');location.assign('/payment-return.html?'+new URLSearchParams({order:orderNumber,provider:'bank'}));return;}
  const u=new URL(data.redirect);if(u.protocol!=='https:'||!['sandbox-web-pay.line.me','www.sandbox.paypal.com'].includes(u.hostname))throw new Error('付款網址不符');
  localStorage.removeItem('wugongCart');location.assign(u.href);return;
 }

 const response=await fetch('/api/payments/ecpay/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderNumber})});const result=await response.json();
 if(!response.ok||!result.success)throw new Error(result.error||'無法開啟付款頁，請到購買紀錄查看訂單');
 if(result.action!=='https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5')throw new Error('付款網址不符');
 const form=document.createElement('form');form.method='POST';form.action=result.action;
 for(const [name,value]of Object.entries(result.fields)){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}
 document.body.append(form);localStorage.removeItem('wugongCart');form.submit();
}
