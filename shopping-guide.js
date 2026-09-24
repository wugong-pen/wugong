const status=document.getElementById('shipping-status'),body=document.getElementById('shipping-rates');
try{
 const response=await fetch('/api/shipping',{cache:'no-store'}),data=await response.json();
 if(!response.ok||!data.success||!Array.isArray(data.regions))throw Error();
 const names=new Intl.DisplayNames(['zh-Hant'],{type:'region'}),order=['TW','JP','KR','SG','HK','US'];
 const regions=data.regions.filter(r=>Number.isSafeInteger(r.fee)&&r.fee>=0).sort((a,b)=>(order.indexOf(a.country)<0?999:order.indexOf(a.country))-(order.indexOf(b.country)<0?999:order.indexOf(b.country)));
 for(const region of regions){const row=document.createElement('tr'),name=document.createElement('th'),fee=document.createElement('td');name.scope='row';name.textContent=region.country==='TW'?'台灣':region.country==='KR'?'韓國':names.of(region.country);fee.textContent='NT$'+region.fee.toLocaleString('en-US')+(region.freeOver?'；商品折扣後滿 NT$'+region.freeOver.toLocaleString('en-US')+' 免運':'');row.append(name,fee);body.append(row);}
 status.textContent=regions.length?'以下顯示目前配送費率，結帳前請再次確認總金額。':'目前尚無開放配送的地區。';
}catch{status.textContent='目前無法讀取最新運費，請稍後重新整理；請勿將空白費率視為免運。';}
