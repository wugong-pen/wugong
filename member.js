import {countryOptions} from './countries.js';
const $=id=>document.getElementById(id);
const next=new URLSearchParams(location.search).get('next')==='checkout';
let page=1,member=null,emailAvailable=false;
const emailLink=new URLSearchParams(location.hash.slice(1));
let emailAction=['verify','reset'].includes(emailLink.get('action'))?emailLink.get('action'):null;
const emailToken=emailLink.get('token');
if(emailAction)history.replaceState(null,'',location.pathname+location.search);
function message(value,error=false){$('message').textContent=value;$('message').classList.toggle('error',error);}
async function api(path,method='GET',data){
  const response=await fetch(path,{method,credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  const result=await response.json();
  if(!response.ok){if(response.status===401&&member){member=null;showAuth();}throw new Error(result.error||'暫時無法完成，請稍後再試');}return result;
}
function tab(register){$('forgotPasswordForm').hidden=true;$('loginForm').hidden=register;$('registerForm').hidden=!register;$('loginTab').setAttribute('aria-pressed',String(!register));$('registerTab').setAttribute('aria-pressed',String(register));message('');}
function showAuth(){member=null;$('auth').hidden=false;$('account').hidden=true;$('checkoutNotice').hidden=!next;$('orders').replaceChildren();$('profileForm').reset();$('passwordForm').reset();}
async function showAccount(m){member=m;$('auth').hidden=true;$('account').hidden=false;$('welcome').textContent=`${m.name}，您好`;$('accountEmail').textContent=m.email;$('emailStatus').textContent=m.emailVerified?'電子郵件已驗證':emailAvailable?'電子郵件尚未驗證，請查看信箱中的驗證信。':'電子郵件尚未驗證；寄信服務準備中。';$('resendVerification').hidden=m.emailVerified||!emailAvailable;$('continueCheckout').hidden=!next;for(const key of ['name','birthday','country','phone','address'])$('profileForm').elements[key].value=m[key]||'';await loadOrders(true);}
function data(form){return Object.fromEntries(new FormData(form));}
function submit(form,action){form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;message('處理中…');try{await action(data(form));}catch(error){message(error.message||'連線失敗，請稍後再試',true);}finally{button.disabled=false;}});}
function confirmPassword(d){if(d.password!==d.confirmPassword)throw new Error('兩次輸入的密碼不一致');}
for(const select of document.querySelectorAll('select[name=country]'))countryOptions(select);
for(const input of document.querySelectorAll('input[type=date]'))input.max=new Date().toISOString().slice(0,10);
$('loginTab').addEventListener('click',()=>tab(false));$('registerTab').addEventListener('click',()=>tab(true));
for(const [id,path]of [['loginForm','login'],['registerForm','register']])submit($(id),async d=>{if(path==='register')confirmPassword(d);const result=await api(`/api/member/${path}`,'POST',d);emailAvailable=result.emailAvailable;$(id).reset();if(next){location.assign('/checkout.html');return;}message(path==='register'?(result.verificationSent?'帳號已建立，驗證信已寄出。請查看收件匣與垃圾郵件。':'帳號已建立，歡迎加入 WUGONG。'):'登入成功');await showAccount(result.member);});
$('forgotPassword').addEventListener('click',()=>{tab(false);$('loginForm').hidden=true;$('forgotPasswordForm').hidden=false;$('sendReset').disabled=!emailAvailable;$('mailSetupNotice').hidden=emailAvailable;});
$('backToLogin').addEventListener('click',()=>tab(false));
submit($('forgotPasswordForm'),async d=>{const result=await api('/api/member/forgot-password','POST',d);message(result.message);});
$('resendVerification').addEventListener('click',async()=>{const button=$('resendVerification');button.disabled=true;try{await api('/api/member/resend-verification','POST',{});message('驗證信已寄出，請查看收件匣與垃圾郵件。');}catch(e){message(e.message,true);}finally{button.disabled=false;}});
submit($('verifyEmailForm'),async()=>{await api('/api/member/verify-email','POST',{token:emailToken});emailAction=null;$('emailAction').hidden=true;await initialize();message('電子郵件驗證完成。');});
submit($('resetPasswordForm'),async d=>{confirmPassword(d);await api('/api/member/reset-password','POST',{token:emailToken,password:d.password});$('resetPasswordForm').reset();emailAction=null;$('emailAction').hidden=true;showAuth();tab(false);message('密碼已重設，請使用新密碼登入。');});
submit($('profileForm'),async d=>{const result=await api('/api/member','PATCH',d);member=result.member;$('welcome').textContent=`${member.name}，您好`;message('會員資料已儲存');});
submit($('passwordForm'),async d=>{confirmPassword(d);await api('/api/member/password','POST',d);showAuth();tab(false);message('密碼已更新，請重新登入。');});
$('logout').addEventListener('click',async()=>{try{await api('/api/member/logout','POST',{});showAuth();tab(false);message('已安全登出');}catch(e){message(e.message,true);}});
const states={expired:'付款期限已過，庫存已釋放',test_paid:'測試付款成功（未實際收款）',payment_failed:'測試付款失敗',pending:'待確認',confirmed:'已確認',paid:'已付款',shipped:'已出貨',completed:'已完成',cancelled:'已取消'};
const payments={paypal_invoice:'海外 PayPal 人工帳單',ecpay:'綠界信用卡（測試）',bank:'銀行轉帳',card:'信用卡',linepay:'LINE Pay'};
function node(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
function orderCard(order){
  const card=node('article','','order');
  if(order.payment==='paypal_invoice'&&order.status==='pending'){card.append(node('p',order.invoice?'帳單已由管理員記錄寄出：'+order.invoice.invoice_number+'；付款期限：'+order.invoice.due_date+'。請查閱 '+order.email+' 的帳單郵件。':'訂單已收到，待確認商品與運費後，另寄 PayPal 帳單至 '+order.email+'。','hint'),node('p','目前為流程測試，請勿實際付款。訂單尚未付款；付款狀態須由管理員核對。逾期由管理員確認，不會自動釋出庫存。','hint'));}
  if(order.reservation_state==='held'&&order.payment!=='paypal_invoice')card.append(node('p','商品保留至 '+new Date(order.reserved_until).toLocaleString('zh-TW')+'，請於期限內開始付款。','hint'));
  if(order.reservation_state==='paying')card.append(node('p',order.payment==='bank'?'匯款須於三天內完成並回報；已回報的訂單會保留庫存等待對帳。':'付款結果確認中，庫存持續保留；若已付款，系統會定期查詢結果，請勿另建訂單重複付款。','hint'));
card.append(node('h3',order.order_number),node('span',states[order.status]||'處理中','status'));
  const date=new Date(order.created_at);card.append(node('p',Number.isFinite(date.getTime())?date.toLocaleString('zh-TW'):'','hint'));
  let items=[];try{items=JSON.parse(order.items);}catch{}const list=document.createElement('ul');
  for(const item of items)list.append(node('li',`${item.product}${item.nib?' · '+item.nib:''} × ${item.quantity}`));
  card.append(list,node('p',`訂單金額 NT$${Number(order.total).toLocaleString('zh-TW')}`));
  const details=document.createElement('details');details.append(node('summary','查看收件與訂單資料'));const dl=document.createElement('dl');
  const region=new Intl.DisplayNames(['zh-Hant'],{type:'region'});
  for(const [label,value]of [['收件人',order.customer_name],['電話',order.phone],['電子郵件',order.email],['收件國家',order.shipping_country==='TW'?'台灣':region.of(order.shipping_country)],['地址',order.address],['配送方式',order.shipping],['付款方式',payments[order.payment]||order.payment],['備註',order.note||'無']])dl.append(node('dt',label),node('dd',value));
  details.append(dl);card.append(details);
  if(['bank','linepay','paypal'].includes(order.payment)&&order.status==='pending'){
   const link=node('a',order.payment==='bank'?'查看匯款資料／回報':'繼續測試付款');link.href='/payment-return.html?'+new URLSearchParams({order:order.order_number,provider:order.payment});card.append(link);
  }
  if(order.payment==='ecpay'&&order.status==='pending')card.append(node('p','若已完成測試付款，請稍後按「重新整理」查看通知結果；尚未完成的訂單不會出貨。','hint'));
  return card;
}
async function loadOrders(reset=false){
  const button=$('moreOrders');button.disabled=true;$('refreshOrders').disabled=true;
  try{if(reset)page=1;const result=await api(`/api/member/orders?page=${page}`);if(reset)$('orders').replaceChildren();for(const order of result.orders)$('orders').append(orderCard(order));if(page===1&&!result.orders.length)$('orders').append(node('p','目前還沒有購買紀錄。登入後建立的訂單會顯示於此。','empty'));button.hidden=!result.hasMore;page++;}
  catch(e){message(e.message,true);}finally{button.disabled=false;$('refreshOrders').disabled=false;}
}
$('moreOrders').addEventListener('click',()=>loadOrders());$('refreshOrders').addEventListener('click',()=>loadOrders(true));
async function initialize(){try{const result=await api('/api/member');emailAvailable=result.emailAvailable;message('');if(emailAction){$('auth').hidden=true;$('account').hidden=true;$('emailAction').hidden=false;$('verifyEmailForm').hidden=emailAction!=='verify';$('resetPasswordForm').hidden=emailAction!=='reset';return;}if(result.member)await showAccount(result.member);else showAuth();}catch(e){message('無法載入會員資料，請重新整理後再試。',true);}}
window.addEventListener('pageshow',e=>{if(e.persisted)initialize();});
initialize();
