const $=id=>document.getElementById(id);
let selected=null;
const fields=['name','phone','address','country','note','checkoutCoupon','firstCoupon'];
export function storeToken(){return $('shipping').value==='cvs'?selected?.token:null;}
export function syncStore(){
 const domestic=$('country').value==='TW';
 $('shipping').querySelector('[value=cvs]').disabled=!domestic;
 if(!domestic)$('shipping').value='宅配';
 const active=domestic&&$('shipping').value==='cvs';$('storePanel').hidden=!active;
 $('address').required=!active;$('address').closest('.field').hidden=active;
 $('storeSummary').textContent=selected?`${selected.brand}｜${selected.name}｜${selected.storeId}\n${selected.address}`:'尚未選擇門市 / Please select a store.';
}
export async function restoreStore(memberId){
 let draft;try{draft=JSON.parse(sessionStorage.getItem('wugongStoreDraft'));}catch{}
 if(draft?.memberId===memberId&&Date.now()-draft.savedAt<3600000){for(const key of fields)if($(key)&&typeof draft[key]==='string')$(key).value=draft[key];if(draft.payment)document.querySelector(`input[name=payment][value="${draft.payment==='bank'?'bank':'ecpay'}"]`).checked=true;}
 sessionStorage.removeItem('wugongStoreDraft');
 const token=new URLSearchParams(location.search).get('store');
 if(token){history.replaceState(null,'','/checkout');const r=await fetch('/api/cvs/selection?token='+encodeURIComponent(token)),d=await r.json();if(!r.ok)throw Error(d.error);selected=d.store;$('shipping').value='cvs';$('storeBrand').value=selected.subtype;}
 syncStore();
}
export function setupStore(getMember,show){
 const option=document.createElement('option');option.value='cvs';option.textContent='超商取貨（7-ELEVEN／全家） / Convenience store pickup';$('shipping').append(option);
 const panel=document.createElement('div');panel.id='storePanel';panel.hidden=true;panel.innerHTML='<label for="storeBrand">取貨超商 / Store chain</label><select id="storeBrand"><option value="UNIMARTC2C">7-ELEVEN</option><option value="FAMIC2C">全家 FamilyMart</option></select><button type="button" id="chooseStore">開啟地圖選店 / Select store on map</button><p id="storeSummary" role="status" style="white-space:pre-wrap"></p><p>請填寫與證件相同的收件人姓名及有效手機。確認收款後寄出，門市不再收款。<br>Use the recipient’s legal name and mobile number. We ship after payment confirmation; no payment is collected at pickup.</p>';
 $('shipping').closest('.field').after(panel);$('shipping').addEventListener('change',syncStore);$('country').addEventListener('change',syncStore);
 $('storeBrand').addEventListener('change',()=>{selected=null;syncStore();});
 $('chooseStore').onclick=async()=>{const member=getMember();if(!member)return;const button=$('chooseStore');button.disabled=true;try{
  const r=await fetch('/api/cvs/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subtype:$('storeBrand').value,mobile:matchMedia('(max-width:700px)').matches})}),d=await r.json();if(!r.ok)throw Error(d.error);
  if(d.action!=='https://logistics.ecpay.com.tw/Express/map')throw Error('無法開啟選店地圖');
  const draft={memberId:member.id,savedAt:Date.now(),payment:document.querySelector('input[name=payment]:checked')?.value};for(const key of fields)draft[key]=$(key)?.value||'';sessionStorage.setItem('wugongStoreDraft',JSON.stringify(draft));
  const form=document.createElement('form');form.method='POST';form.action=d.action;for(const [key,value]of Object.entries(d.fields)){const input=document.createElement('input');input.type='hidden';input.name=key;input.value=value;form.append(input);}document.body.append(form);form.submit();
 }catch(e){show(e.message);}finally{button.disabled=false;}};
}
