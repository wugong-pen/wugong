export async function renderInvoice({o,api,node,reload,message}){
 const {invoice}=await api('/api/admin/manual-invoice?order='+encodeURIComponent(o.order_number));
 const panel=node('section');panel.id='manual-invoice';panel.className='manage-form';
 panel.append(node('h2','海外 PayPal 人工帳單'),node('p','目前僅供流程測試，請勿寄出真實收款帳單。網站不會代寄 Email，也不會向 PayPal 查詢或取消帳單。'));
 panel.append(node('p','收件信箱：'+o.email+'｜帳單幣別：TWD｜應收總額：NT$'+o.total.toLocaleString()),node('p','請在 PayPal 手動建立帳單，註明網站訂單編號 '+o.order_number+'。帳單金額須與網站訂單總額一致；若商品或運費需變更，先取消原帳單及訂單，再重新下單。'));
 if(invoice)panel.append(node('p','已記錄帳單：'+invoice.invoice_number+'｜期限：'+invoice.due_date));
 document.getElementById('content').after(panel);if(o.status!=='pending')return;
 const field=(form,label,type,value='')=>{const l=node('label',label),i=node('input');i.type=type;i.value=value;i.required=true;l.append(i);form.append(l);return i;};
 const sent=node('form'),ref=field(sent,'PayPal 帳單編號','text',invoice?.invoice_number||''),due=field(sent,'帳單付款期限','date',invoice?.due_date||'');ref.maxLength=80;
 const sentCheck=field(sent,'確認已在 PayPal 寄送相同總額與幣別的測試帳單；更換帳單時已作廢舊帳單','checkbox');
 const save=node('button','記錄已寄出帳單');save.type='submit';sent.append(save);panel.append(sent);
 const submit=async(button,data)=>{button.disabled=true;try{await api('/api/admin/manual-invoice','POST',{orderNumber:o.order_number,version:invoice?.version||0,...data});await reload();message('帳單紀錄已更新。');}catch(e){message(e.message);}finally{button.disabled=false;}};
 sent.onsubmit=e=>{e.preventDefault();submit(save,{action:'sent',invoiceNumber:ref.value,dueDate:due.value,confirmed:sentCheck.checked});};
 panel.append(node('p','到期不會自動取消。取消前請先到 PayPal 確認未收款並取消帳單，再使用本頁「取消未付款訂單」，以恢復庫存與首購資格。'));
 if(!invoice)return;
 const paid=node('form');paid.append(node('h3','人工收款核對（測試）'));
 const tx=field(paid,'PayPal 付款交易編號（不是帳單編號）','text'),amount=field(paid,'核對交易總額（TWD，扣除手續費之前）','number');amount.min='1';amount.step='1';tx.maxLength=80;
 const paidCheck=field(paid,'已在 PayPal 核對此帳單付款完成、收款對象及 TWD 總額一致，非待處理款項或買家截圖','checkbox');
 const settle=node('button','記錄測試收款完成');settle.type='submit';paid.append(settle);panel.append(paid);
 paid.onsubmit=e=>{e.preventDefault();submit(settle,{action:'paid',transactionId:tx.value,amount:Number(amount.value),currency:'TWD',confirmed:paidCheck.checked});};
}
