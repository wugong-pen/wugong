export function renderBank({o,api,node,reload,message}){
 document.getElementById('bank-confirm')?.remove();if(o.status!=='pending')return;
 const form=node('form');form.id='bank-confirm';form.className='manage-form';form.append(node('h2','銀行匯款入帳核對'),node('p','請先查看銀行實際入帳，再填寫本表。會員回報或截圖不代表已收到款項。'));
 function field(label,type){const l=node('label',label),input=node('input');input.type=type;input.required=true;l.append(input);form.append(l);return input;}
 const reference=field('銀行入帳紀錄編號（同一筆款項不得重複使用）','text');reference.maxLength=100;
 const amount=field('實際入帳金額（新台幣）','number');amount.min=1;amount.step=1;
 const checked=field('已核對銀行入帳、買家資料及訂單總額一致','checkbox');
 const submit=node('button','確認入帳並通知買家');submit.type='submit';form.append(submit);document.getElementById('content').after(form);
 form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await api('/api/admin/bank/confirm','POST',{orderNumber:o.order_number,reference:reference.value,amount:Number(amount.value),confirmed:checked.checked});await reload();message('已確認收款，買家收款通知已排入寄送。');}catch(error){message(error.message);}finally{submit.disabled=false;}};
}
