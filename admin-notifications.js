export async function renderNotifications({api,node,order}){
 document.getElementById('order-notifications')?.remove();
 const panel=node('section');panel.id='order-notifications';panel.className='card';
 const title=node('h2','新訂單 Email 通知'),summary=node('p'),list=node('div'),refresh=node('button','更新寄送狀態');refresh.type='button';panel.append(title,summary,list,refresh);
 document.getElementById('message').after(panel);
 const show=d=>{summary.textContent='收件信箱：'+d.recipient+(d.configured?'':'｜寄信服務未設定完成，通知會保留待寄。');list.replaceChildren();for(const n of d.notifications){list.append(node('p',(n.order_number||'寄信測試')+'：'+({queued:'等待寄送／重試中',sent:'寄信服務已接受（不代表已進入收件匣）',attention:'需要人工檢查寄送結果'})[n.state]+(n.sent_at?'｜'+new Date(n.sent_at).toLocaleString('zh-TW'):'')+(n.last_error?'｜'+n.last_error:'')));}if(!d.notifications.length)list.append(node('p',order?'此訂單沒有通知紀錄（舊訂單不補寄）。':'尚無通知紀錄。'));};
 const load=async()=>{try{show(await api('/api/admin/order-notifications'+(order?'?order='+encodeURIComponent(order):'')));}catch(e){summary.textContent=e.message;}};
 refresh.onclick=load;
 if(!order){const test=node('button','寄送測試通知到管理員信箱');test.type='button';panel.append(test);test.onclick=async()=>{test.disabled=true;try{show(await api('/api/admin/order-notifications','POST',{}));}catch(e){summary.textContent=e.message;}finally{test.disabled=false;}};}
 await load();
}
