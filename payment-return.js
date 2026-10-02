const params=new URLSearchParams(location.search),orderNumber=params.get('order'),$=id=>document.getElementById(id);
let payment='';
const show=t=>$('message').textContent=t;
async function api(path,data){const r=await fetch(path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const result=await r.json();if(!r.ok||!result.success)throw new Error(result.error||'無法確認付款');return result;}
async function begin(){
 if(['ecpay','ecpay_twqr'].includes(payment)){const result=await api('/api/payments/ecpay/start',{orderNumber});if(result.action!=='https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5')throw Error('付款網址不符');const form=document.createElement('form');form.method='POST';form.action=result.action;for(const [name,value]of Object.entries(result.fields)){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}document.body.append(form);form.submit();return;}
 const result=await api('/api/payments/start',{orderNumber});
 if(result.bank){$('bank').hidden=false;$('details').replaceChildren();for(const [k,v] of [['銀行',result.bank.bank],['代碼',result.bank.code],['分行',result.bank.branch],['戶名',result.bank.holder],['帳號',result.bank.account],['期限',new Date(result.dueAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;$('details').append(dt,dd);}if(Date.parse(result.dueAt)<=Date.now()){$('report').hidden=true;show('匯款期限已過，請聯絡商家確認後續處理。');}return;}
 const u=new URL(result.redirect);if(u.protocol!=='https:'||!['sandbox-web-pay.line.me','www.sandbox.paypal.com'].includes(u.hostname))throw new Error('付款網址不符');location.assign(u.href);
}
$('continue').onclick=async()=>{$('continue').disabled=true;try{await begin();}catch(e){show(e.message);}finally{$('continue').disabled=false;}};
$('report').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const r=await api('/api/payments/bank/report',{orderNumber,last5:$('last5').value,date:$('date').value});show(r.message);}catch(e){show(e.message);}finally{button.disabled=false;}};
try{
 const {order}=await api('/api/member/orders/'+encodeURIComponent(orderNumber));
 payment=order.payment;
 show(`訂單 ${order.order_number} · NT$${order.total.toLocaleString()} · ${({paid:'已付款',shipped:'已出貨',completed:'已完成',cancelled:'已取消',expired:'已逾期',test_paid:'歷史模擬付款紀錄'})[order.status]||'待確認付款'}`);
 if(order.status==='pending'){
  if(order.payment==='bank')await begin();
  else if(['ecpay','ecpay_twqr'].includes(order.payment)){$('continue').hidden=false;show('付款結果確認中；若已完成付款，請稍後返回購買紀錄確認，勿重複付款。若尚未付款，可按下方按鈕繼續。');}
  else if(params.get('cancel'))show('已返回商店，付款尚未確認。可至購買紀錄繼續付款。');
  else if(params.get('state')){
   await api('/api/payments/confirm',{orderNumber,state:params.get('state'),transactionId:params.get('transactionId'),token:params.get('token')});show('測試付款已由伺服器確認完成，請至購買紀錄查看。');history.replaceState(null,'',location.pathname+'?'+new URLSearchParams({order:orderNumber}));
  }else $('continue').hidden=false;
 }
}catch(e){show(e.message+'。若需登入，請先返回會員頁；登入後可重新開啟本頁。');}
