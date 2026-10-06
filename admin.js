import {conversationPanel} from './order-conversation.js';
const $=id=>document.getElementById(id);
if(document.body.dataset.page!=='login'){
 const style=document.createElement('link');style.rel='stylesheet';style.href='/manage.css';document.head.append(style);
 const nav=document.createElement('nav');nav.className='admin-nav';nav.setAttribute('aria-label','後台管理');
 for(const [label,url] of [['首頁編輯','/admin-manage.html?section=homepage'],['網誌圖文','/admin-manage.html?section=blog'],['獲獎紀錄','/admin-manage.html?section=awards'],['活動花絮','/admin-manage.html?section=events'],['媒體採訪','/admin-manage.html?section=media'],['訂單管理','/admin-orders.html'],['商品管理','/admin-manage.html?section=products'],['筆款庫存／影片','/admin-manage.html?section=stock'],['尖型管理','/admin-manage.html?section=nibs'],['筆尖與規格指南','/admin-manage.html?section=nib-guide'],['品牌／商品分類','/admin-manage.html?section=categories'],['配送國家／運費','/admin-manage.html?section=shipping'],['優惠券','/admin-manage.html?section=coupons'],['會員管理','/admin-manage.html?section=members'],['買家電子報','/admin-manage.html?section=newsletter'],['操作紀錄','/admin-manage.html?section=audit'],['查看商店','/shop.html']]){const a=document.createElement('a');a.textContent=label;a.href=url;if((url.includes(location.search)&&url.includes('admin-manage')&&location.pathname.includes('admin-manage'))||(!location.search&&url.includes('admin-orders')&&location.pathname.includes('admin-orders')))a.setAttribute('aria-current','page');nav.append(a);}document.querySelector('header').after(nav);
}
const labels={pending:'待付款',confirmed:'已確認',paid:'已付款',test_paid:'模擬付款紀錄',shipped:'已出貨',completed:'已完成',cancelled:'已取消',expired:'已逾期'};
const payments={ecpay:'綠界信用卡',ecpay_twqr:'歐付寶 TWQR',paypal_invoice:'海外 PayPal 人工帳單',bank:'銀行匯款',paypal:'PayPal',linepay:'LINE Pay'};
const money=n=>'NT$ '+Number(n).toLocaleString('zh-TW');
let page=1,currentOrder;
const message=s=>{$('message').textContent=s;};
async function api(path,method='GET',data){
 const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const result=await r.json();
 if(!r.ok){
  if([401,403].includes(r.status)&&document.body.dataset.page!=='login'){location.replace('/admin-login.html');}
  throw new Error(result.error||'操作未完成，請稍後再試');
 }
 return result;
}
function node(tag,value){const el=document.createElement(tag);el.textContent=value??'';return el;}
function date(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('zh-TW'):String(value||'');}
function items(value){try{const parsed=typeof value==='string'?JSON.parse(value):value;if(!Array.isArray(parsed))return String(value||'');return parsed.map(i=>`${i.product||i.name||'商品'}${i.nib?' / '+i.nib:''} × ${i.quantity||i.qty||1}`).join('\n');}catch{return String(value||'');}}
async function loadOrders(){
 message('正在讀取訂單…');$('orders').replaceChildren();$('previous').disabled=true;$('next').disabled=true;
 try{const result=await api('/api/admin/orders?'+new URLSearchParams({page,q:$('order-search')?.value||'',status:$('order-status')?.value||''}));
  for(const o of result.orders){const tr=node('tr'),td=node('td'),link=node('a',o.order_number);link.href='/admin-order-detail.html?order='+encodeURIComponent(o.order_number);td.append(link);tr.append(td);for(const v of [o.customer_name,money(o.total),payments[o.payment]||o.payment,labels[o.status]||o.status,date(o.created_at)])tr.append(node('td',v));$('orders').append(tr);}
  $('page').textContent='第 '+page+' 頁';$('previous').disabled=page===1;$('next').disabled=!result.hasMore;message(result.orders.length?'':'目前沒有訂單');
 }catch(e){message(e.message);}
}
async function loadDetail(){
 message('正在讀取訂單…');$('content').replaceChildren();$('advance').hidden=true;
 document.getElementById('factory-date-panel')?.remove();document.getElementById('cancel-order')?.remove();document.getElementById('cancel-confirmation')?.remove();
 try{const number=new URLSearchParams(location.search).get('order');if(!number)throw new Error('缺少訂單編號');
  const {order:o}=await api('/api/admin/orders/'+encodeURIComponent(number));currentOrder=o;
  const dl=node('dl');for(const [label,value] of [['訂單編號',o.order_number],['姓名',o.customer_name],['電話',o.phone],['電子郵件',o.email],['收件國家',o.shipping_country||'未記錄'],['收件地址',o.address],['商品',items(o.items)],['金額',money(o.total)],['付款方式',payments[o.payment]||o.payment],['配送方式',o.shipping],['狀態',labels[o.status]||o.status],['備註',(o.note||'').includes('\n配送運費：')?'配送運費：'+o.note.split('\n配送運費：').slice(1).join('\n配送運費：'):'無'],['下單時間',date(o.created_at)]])dl.append(node('dt',label),node('dd',value));$('content').append(dl,conversationPanel({api,order:o.order_number,admin:true}));
  if(['paid','shipped'].includes(o.status)||(o.status==='test_paid'&&!o.live_mode)){$('advance').textContent=o.status!=='shipped'?'標記為已出貨':'標記為已完成';$('advance').hidden=false;}
  const factoryPanel=node('section');factoryPanel.id='factory-date-panel';factoryPanel.className='card';const factoryLabel=node('label','出廠日期（請與隨貨保固卡一致）'),factoryInput=node('input');factoryInput.type='date';factoryInput.id='factory-date';factoryInput.value=o.factory_date||'';factoryInput.max=new Date(Date.now()+8*3600000).toISOString().slice(0,10);factoryInput.required=true;factoryInput.disabled=!(o.status==='paid'||o.status==='test_paid'&&!o.live_mode);factoryLabel.append(factoryInput);factoryPanel.append(factoryLabel,node('p','保固期間：自出廠日期起一年。標記出貨時儲存，並寫入買家出貨通知信。'));$('advance').before(factoryPanel);
  message('');
  await orderManagement(o.order_number);
  await (await import('./admin-logistics.js')).renderLogistics({api,node,message,o,reload:loadDetail});
  await (await import('./admin-notifications.js')).renderNotifications({api,node,order:o.order_number});
  document.getElementById('manual-invoice')?.remove();
  document.getElementById('bank-confirm')?.remove();
  if(o.payment==='bank')await (await import('./admin-bank.js')).renderBank({o,api,node,reload:loadDetail,message});
  if(o.payment==='paypal_invoice')await (await import('./admin-invoice.js')).renderInvoice({o,api,node,reload:loadDetail,message});
  if(o.status==='pending'){
   const cancel=node('button','取消未付款訂單');cancel.id='cancel-order';cancel.type='button';$('advance').after(cancel);
   cancel.onclick=()=>{cancel.hidden=true;const panel=node('section');panel.id='cancel-confirmation';panel.className='card';panel.append(node('p','確認取消此訂單？商品保留將釋放，首購贈品資格會恢復。已回報匯款或付款確認中的訂單須先核對。'));const confirmCancel=node('button','確認取消訂單'),back=node('button','返回');confirmCancel.type=back.type='button';let invoiceCheck=null;if(o.payment==='paypal_invoice'){const label=node('label','我已在 PayPal 確認尚未收款，且未寄出帳單或已取消所有可付款帳單。');invoiceCheck=node('input');invoiceCheck.type='checkbox';label.prepend(invoiceCheck);panel.append(label);}panel.append(confirmCancel,back);cancel.after(panel);back.onclick=()=>{panel.remove();cancel.hidden=false;};confirmCancel.onclick=async()=>{if(invoiceCheck&&!invoiceCheck.checked){message('請先取消 PayPal 帳單並確認未收款。');return;}confirmCancel.disabled=back.disabled=true;try{await api('/api/admin/order/status','POST',{orderNumber:o.order_number,expectedStatus:'pending',status:'cancelled',invoiceCancelled:invoiceCheck?.checked===true});await loadDetail();message('訂單已取消，首購贈品資格已釋放。');}catch(e){await loadDetail();message(e.message);}};};
  }
 }catch(e){message(e.message);}
}
if(document.body.dataset.page==='login'){
 $('login').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;message('正在登入…');try{await api('/api/admin/login','POST',{email:$('email').value,password:$('password').value});$('password').value='';location.replace('/admin-orders.html');}catch(e){message(e.message);$('password').value='';}finally{button.disabled=false;}});
}else{
 $('logout').addEventListener('click',async()=>{try{await api('/api/admin/logout','POST',{});location.replace('/admin-login.html');}catch(e){message(e.message);}});
 addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 try{const {admin}=await api('/api/admin/session');$('identity').textContent=admin.email;
  if(document.body.dataset.page==='manage'){await (await import('./admin-manage.js')).init({api,node,message});}
  else if(document.body.dataset.page==='orders'){
   await (await import('./admin-logistics.js')).renderLogistics({api,node,message});
   await (await import('./admin-notifications.js')).renderNotifications({api,node});
   const search=node('form');search.className='search-form';const input=node('input');input.id='order-search';input.placeholder='搜尋訂單編號、收件人或信箱';input.maxLength=100;input.setAttribute('aria-label','搜尋訂單');const select=node('select');select.id='order-status';select.setAttribute('aria-label','訂單狀態');for(const [v,label]of [['','全部狀態'],...Object.entries(labels)]){const option=node('option',label);option.value=v;select.append(option);}const submit=node('button','篩選');search.append(input,select,submit);$('message').after(search);search.onsubmit=e=>{e.preventDefault();page=1;loadOrders();};
   $('refresh').onclick=loadOrders;$('previous').onclick=()=>{page--;loadOrders();};$('next').onclick=()=>{page++;loadOrders();};await loadOrders();}
  else{$('advance').onclick=async()=>{const button=$('advance');button.disabled=true;try{if(currentOrder.status!=='shipped'&&!$('factory-date').reportValidity())return;await api('/api/admin/order/status','POST',{factoryDate:$('factory-date')?.value||'',orderNumber:currentOrder.order_number,expectedStatus:currentOrder.status,status:currentOrder.status!=='shipped'?'shipped':'completed'});await loadDetail();}catch(e){await loadDetail();message(e.message);}finally{button.disabled=false;}};await loadDetail();}
 }catch(e){message(e.message);}
}
async function orderManagement(number){
 document.getElementById('order-management')?.remove();
 const d=await api('/api/admin/order-management?order='+encodeURIComponent(number)),form=node('form');form.id='order-management';form.className='manage-form';form.append(node('h2','內部備註與出貨資料'),node('p','請先儲存物流公司與單號，再標記為已出貨；系統會寄送買家出貨通知；含鋼筆的訂單將於出貨後第 5 天自動寄送書寫關懷信。出貨後修改物流資料不會自動重寄，如需更正已寄出的資料，請另行聯絡買家。'));
 if(d.firstGift)form.append(node('p','首購資格：'+({reserved:'保留中（完成訂單後記為已領取）',received:'已領取',released:'已恢復資格；本取消／失效訂單不再贈送'})[d.firstGift.state]),node('p',d.firstGift.notice));
 if(d.gift)form.append(node('p',(d.firstGift?.state==='released'?'原訂單贈品紀錄：':'贈送商品：')+d.gift.description+(d.firstGift?.state==='released'?'（此訂單已失效）':'（請核對出貨）')));
 if(d.discount)form.append(node('p','優惠券 '+d.discount.code+'｜商品小計 NT$'+d.discount.subtotal.toLocaleString()+'｜折抵 NT$'+d.discount.discount.toLocaleString()));
 const inputs={};for(const [key,label]of [['admin_note','內部備註（不會顯示給會員）'],['carrier','物流公司'],['tracking','物流單號']]){const l=node('label',label),input=node(key==='admin_note'?'textarea':'input');input.value=d.management[key];input.maxLength=key==='admin_note'?4000:100;l.append(input);form.append(l);inputs[key]=input;}
 if(d.remittance?.reported_at)form.append(node('p','會員匯款回報：末五碼 '+d.remittance.remittance_last5+'；日期 '+d.remittance.remittance_date+'。回報尚不代表收款完成。'));
 const save=node('button','儲存備註與物流資料');save.type='submit';form.append(save);$('content').after(form);form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api('/api/admin/order-management','POST',{orderNumber:number,version:d.management.version,...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]))});await orderManagement(number);message('訂單管理資料已儲存。');}catch(e){message(e.message);}finally{save.disabled=false;}};
}
