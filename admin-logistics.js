export async function renderLogistics({api,node,message,o,reload}){
 document.getElementById('logistics-panel')?.remove();
 const d=await api('/api/admin/logistics'+(o?'?order='+encodeURIComponent(o.order_number):''));
 if(o&&!d.store&&!d.logistics)return;
 const panel=node('section');panel.id='logistics-panel';panel.className='manage-form';panel.append(node('h2','綠界超商寄件單'));
 (o?document.getElementById('order-management'):document.getElementById('message')).after(panel);
 const info=node('p');info.setAttribute('role','status');panel.append(info);
 const senderForm=node('form'),nameLabel=node('label','寄件人真實姓名'),name=node('input'),phoneLabel=node('label','寄件手機'),phone=node('input'),save=node('button','儲存寄件人');
 name.value=d.sender.sender_name;name.required=true;name.maxLength=10;phone.value=d.sender.sender_phone;phone.required=true;phone.type='tel';phone.pattern='09[0-9]{8}';phone.maxLength=10;save.type='submit';nameLabel.append(name);phoneLabel.append(phone);senderForm.append(nameLabel,phoneLabel,save);panel.append(senderForm);
 senderForm.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api('/api/admin/logistics','POST',{action:'settings',sender_name:name.value.trim(),sender_phone:phone.value.trim(),version:d.sender.version});await renderLogistics({api,node,message,o,reload});message('寄件人已儲存。');}catch(e){info.textContent=e.message;}finally{save.disabled=false;}};
 panel.append(node('p','請填寫可憑證件領回退件的姓名。7-ELEVEN／全家採純取貨，門市不收款。'));
 if(!d.credentialsReady)panel.append(node('p','綠界正式物流金鑰尚未設定完成。'));
 if(!o){panel.append(node('p','開啟已付款的超商訂單，即可自動帶入買家資料、建立及列印寄件單。'));return;}
 if(d.store)panel.append(node('p','收件門市：'+d.store.store_name+'（'+d.store.store_id+'） '+d.store.address));
 panel.append(node('p','商品金額（不含運費）：'+(d.goodsAmount===null?'尚未記錄':'NT$'+d.goodsAmount.toLocaleString())+'。綠界超商建單限 NT$1～20,000，超過請另行安排配送。'));
 panel.append(node('p','建立寄件單後請列印、包裝並交寄。實際交寄後，再填出廠日期並標記為已出貨，系統才會寄出買家出貨通知。綠界物流費依您的合約及帳戶扣款規則收取。'));
 const action=(title,kind)=>{const b=node('button',title);b.type='button';panel.append(b);b.onclick=async()=>{b.disabled=true;info.textContent='處理中…';try{const r=await api('/api/admin/logistics','POST',{action:kind,orderNumber:o.order_number});if(kind==='print'){const form=node('form');form.method='POST';form.action=r.action;for(const[k,v]of Object.entries(r.fields)){const input=node('input');input.type='hidden';input.name=k;input.value=v;form.append(input);}document.body.append(form);form.submit();return;}await reload();message(r.logistics?.state==='uncertain'?'建單結果待確認，請查詢／同步物流。':'物流資料已更新。');}catch(e){info.textContent=e.message;}finally{b.disabled=false;}};return b;};
 const r=d.logistics;
 if(!r){const b=action('建立綠界寄件單','create');b.disabled=o.status!=='paid'||!d.credentialsReady||!d.sender.version||d.goodsAmount<1||d.goodsAmount>20000||d.goodsAmount===null;if(o.status!=='paid')panel.append(node('p','確認收款後才能建立寄件單。'));}
 else{
  panel.append(node('p','建單狀態：'+({created:'已建立',creating:'建立中／待核對',uncertain:'結果待核對'})[r.state]),node('p','物流交易編號：'+(r.logistics_id||'待確認')),node('p','寄貨編號：'+(r.payment_no?r.payment_no+(r.validation_no||''):'待確認')),node('p','物流狀態：'+(r.status_message||r.error||'待回傳')));
  action('查詢／同步物流','query');
  if(r.state==='created'&&r.payment_no){action('列印寄件單','print');action('帶入出貨通知的物流單號','use-tracking');}
 }
}
