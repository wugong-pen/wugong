export async function renderNotifications({api,node,order}){
 document.getElementById('order-notifications')?.remove();
 const panel=node('section');panel.id='order-notifications';panel.className='card';
 const title=node('h2','訂單 Email 通知'),summary=node('p'),list=node('div'),refresh=node('button','更新寄送狀態');refresh.type='button';panel.append(title,summary,list,refresh);
 document.getElementById('message').after(panel);
 const show=d=>{summary.textContent='管理員信箱：'+d.recipient+'；買家通知寄至下單會員 Email。'+(d.configured?'':'｜寄信服務未設定完成，通知會保留待寄。');list.replaceChildren();for(const n of d.notifications){list.append(node('p',(n.order_number||'寄信測試')+'｜'+({bank_report:'買家匯款回報',buyer_paid:'買家收款確認',newsletter:'買家電子報',newyear_preview:'新年關懷信內容預覽',buyer_newyear:'年度新年關懷',buyer_preview:'買家信件內容預覽',buyer_care:'出貨後書寫關懷',buyer_confirmed:'買家下單確認',buyer_shipped:'買家出貨通知',admin:'管理員通知'})[n.kind]+'：'+({cancelled:'已停止寄送',queued:'等待寄送／重試中',sent:'寄信服務已接受（不代表已進入收件匣）',attention:'需要人工檢查寄送結果'})[n.state]+(n.kind==='buyer_care'&&n.state==='queued'&&n.attempts===0?'｜預計寄送：'+new Date(n.next_attempt).toLocaleString('zh-TW'):'')+(n.sent_at?'｜'+new Date(n.sent_at).toLocaleString('zh-TW'):'')+(n.last_error?'｜'+n.last_error:'')));}if(!d.notifications.length)list.append(node('p',order?'此訂單沒有通知紀錄（舊訂單不補寄）。':'尚無通知紀錄。'));};
 const load=async()=>{try{show(await api('/api/admin/order-notifications'+(order?'?order='+encodeURIComponent(order):'')));}catch(e){summary.textContent=e.message;}};
 refresh.onclick=load;
 if(!order){const test=node('button','寄送測試通知到管理員信箱');test.type='button';panel.append(test);test.onclick=async()=>{test.disabled=true;try{show(await api('/api/admin/order-notifications','POST',{}));}catch(e){summary.textContent=e.message;}finally{test.disabled=false;}};}

 if(!order){const form=node('form'),label=node('label','買家信件預覽收件 Email'),email=node('input'),send=node('button','寄送六封買家信件內容預覽');email.type='email';email.required=true;email.maxLength=254;label.append(email);send.type='submit';form.append(node('p','寄送國內／海外下單確認、出貨、書寫關懷、會員驗證與密碼重設各一封。使用示例資料，不建立訂單或有效驗證連結。'),label,send);panel.append(form);const key=crypto.randomUUID();form.onsubmit=async e=>{e.preventDefault();send.disabled=true;email.disabled=true;try{show(await api('/api/admin/order-notifications','POST',{kind:'buyer-preview',email:email.value.trim(),key}));send.textContent='預覽已排入寄送，請查看狀態';}catch(e){summary.textContent=e.message;send.disabled=false;email.disabled=false;}};}
 if(!order){
  const form=node('form'),label=node('label','新年關懷信預覽收件 Email'),email=node('input'),send=node('button','寄送一封新年關懷信預覽');
  email.type='email';email.required=true;email.maxLength=254;label.append(email);send.type='submit';
  form.append(node('h3','每年新年關懷信'),node('p','已啟用：每年 1 月 1 日上午 9 點起（台灣時間）分批寄送中英文新年祝福與書寫關懷。對象為元旦前已有出貨或完成訂單的有效會員；排除模擬付款紀錄及已停止年度問候者，同一 Email 每年只寄一封。'),label,send);panel.append(form);
  const key=crypto.randomUUID();form.onsubmit=async e=>{e.preventDefault();send.disabled=true;email.disabled=true;try{show(await api('/api/admin/order-notifications','POST',{kind:'newyear-preview',email:email.value.trim(),key}));send.textContent='新年關懷預覽已排入寄送，請查看狀態';}catch(e){summary.textContent=e.message;send.disabled=false;email.disabled=false;}};
 }
 await load();
}
