const $=id=>document.getElementById(id);
let selected=null,goodsAmount=0;
export function setStoreAmount(value){goodsAmount=value;syncStore();}
export function manualStore(){return $('shipping').value==='cvs_manual'?{name:$('manualName').value,phone:$('manualPhone').value,brand:$('manualBrand').value,storeName:$('manualStoreName').value}:null;}
export function validateManualStore(){return $('shipping').value!=='cvs_manual'||['manualName','manualPhone','manualStoreName'].every(k=>$(k).reportValidity());}
const fields=['name','phone','address','country','note','checkoutCoupon','firstCoupon'];
export function storeToken(){return $('shipping').value==='cvs'?selected?.token:null;}
export function syncStore(){
 const domestic=$('country').value==='TW';
 const high=goodsAmount>20000;
 $('shipping').querySelector('[value=cvs]').disabled=!domestic||high;
 $('shipping').querySelector('[value=cvs]').hidden=!domestic||high;
 $('shipping').querySelector('[value=cvs_manual]').hidden=!domestic||!high;
 $('shipping').querySelector('[value=cvs_manual]').disabled=!domestic||!high;
 $('shipping').options[0].textContent=domestic?(high?'郵局包裹 / Postal parcel':'宅配 / Home delivery'):'海外郵寄／快遞';
 if(domestic&&high&&$('shipping').value==='cvs')$('shipping').value='';
 if(!high&&$('shipping').value==='cvs_manual')$('shipping').value='宅配';
 $('highValueNotice').hidden=!domestic||!high;
 if(!domestic)$('shipping').value='宅配';
 const active=domestic&&$('shipping').value==='cvs';$('storePanel').hidden=!active;
 const manual=domestic&&high&&$('shipping').value==='cvs_manual';$('manualStorePanel').hidden=!manual;
 for(const k of ['manualName','manualPhone','manualStoreName'])$(k).required=manual;
 $('address').required=!active&&!manual;$('address').closest('.field').hidden=active||manual;
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
 const manualOption=document.createElement('option');manualOption.value='cvs_manual';manualOption.textContent='聯絡我們安排超商取貨 / Arrange store pickup with us';$('shipping').append(manualOption);
 const highNotice=document.createElement('p');highNotice.id='highValueNotice';highNotice.hidden=true;highNotice.textContent='商品金額超過 NT$20,000，請選擇郵局包裹，或填寫門市資料由我們聯絡確認並人工寄出。 / Over NT$20,000: choose postal delivery or request manually arranged store pickup.';
 const manualPanel=document.createElement('div');manualPanel.id='manualStorePanel';manualPanel.hidden=true;manualPanel.innerHTML='<label for=manualName>取貨人姓名 / Recipient name</label><input id=manualName maxlength=100><label for=manualPhone>取貨人手機 / Mobile number</label><input id=manualPhone type=tel maxlength=10 pattern="09[0-9]{8}"><label for=manualBrand>取貨超商 / Store chain</label><select id=manualBrand><option value=UNIMARTC2C>7-ELEVEN</option><option value=FAMIC2C>全家 FamilyMart</option></select><label for=manualStoreName>門市名稱（請包含縣市區域） / Store name and district</label><input id=manualStoreName maxlength=100><p>我們收到訂單後會與您確認門市及配送安排，確認收款後由管理員人工寄出，門市不收款。 / We will contact you to confirm delivery arrangements and ship after payment confirmation. No payment is collected at pickup.</p>';
 $('shipping').closest('.field').after(highNotice,panel,manualPanel);
 $('shipping').addEventListener('change',()=>{if($('shipping').value==='cvs_manual'){if(!$('manualName').value)$('manualName').value=$('name').value;if(!$('manualPhone').value)$('manualPhone').value=$('phone').value;}});$('shipping').addEventListener('change',syncStore);$('country').addEventListener('change',syncStore);
 $('storeBrand').addEventListener('change',()=>{selected=null;syncStore();});
 $('chooseStore').onclick=async()=>{const member=getMember();if(!member)return;const button=$('chooseStore');button.disabled=true;try{
  const r=await fetch('/api/cvs/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subtype:$('storeBrand').value,mobile:matchMedia('(max-width:700px)').matches})}),d=await r.json();if(!r.ok)throw Error(d.error);
  if(d.action!=='https://logistics.ecpay.com.tw/Express/map')throw Error('無法開啟選店地圖');
  const draft={memberId:member.id,savedAt:Date.now(),payment:document.querySelector('input[name=payment]:checked')?.value};for(const key of fields)draft[key]=$(key)?.value||'';sessionStorage.setItem('wugongStoreDraft',JSON.stringify(draft));
  const form=document.createElement('form');form.method='POST';form.action=d.action;for(const [key,value]of Object.entries(d.fields)){const input=document.createElement('input');input.type='hidden';input.name=key;input.value=value;form.append(input);}document.body.append(form);form.submit();
 }catch(e){show(e.message);}finally{button.disabled=false;}};
}
