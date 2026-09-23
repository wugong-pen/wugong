import {countryOptions} from './countries.js';
export async function init({api,node,message}){
 if(new URLSearchParams(location.search).get('section')!=='shipping')return false;
 const view=document.getElementById('manage-view'),editor=document.getElementById('editor'),names=new Intl.DisplayNames(['zh-Hant'],{type:'region'});
 document.getElementById('heading').textContent='配送國家／運費';
 const button=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=fn;return b;};
 function edit(r={country:'',enabled:0,fee:null,note:'',version:0}){
  editor.replaceChildren();const f=node('form');f.className='manage-form';
  const field=(label,type,value)=>{const l=node('label',label),i=node(type==='textarea'?'textarea':type==='select'?'select':'input');if(type!=='textarea'&&type!=='select')i.type=type;i.value=value??'';l.append(i);f.append(l);return i;};
  f.append(node('h2','配送設定'));
  const country=field('國家／地區','select','');countryOptions(country,r.country);country.required=true;country.disabled=!!r.version;
  const fee=field('每筆訂單運費（新台幣整數；0 表示免運，空白表示待確認）','number',r.fee);fee.min=0;fee.max=100000;fee.step=1;
  const enabled=field('開放配送','checkbox','');enabled.checked=!!r.enabled;
  const note=field('內部成本／物流備註（不會顯示給顧客）','textarea',r.note);note.maxLength=1000;
  f.append(node('p','請確認物流可承運、費率適用包裹範圍後再開放。多件或較大包裹也會收取此固定費率。海外禁止墨水，包含贈品。海外運費不含進口關稅，關稅由收件人另行負擔。'));
  const save=node('button','儲存設定');save.type='submit';f.append(save);editor.append(f);
  f.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api('/api/admin/shipping','POST',{country:country.value,enabled:enabled.checked?1:0,fee:fee.value.trim()===''?null:Number(fee.value),note:note.value,version:r.version});editor.replaceChildren();await load();message('配送設定已儲存。');}catch(e){message(e.message);}finally{save.disabled=false;}};
 }
 async function load(){const d=await api('/api/admin/shipping');view.replaceChildren(node('p','只有已開放並確認運費的地區能結帳。會員註冊國家不受此設定限制。運費在商品折扣後另計，既有訂單金額不受修改影響。'),button('新增配送地區',()=>edit()));for(const r of d.regions){const c=node('section');c.className='manage-form';c.append(node('h2',r.country==='TW'?'台灣':names.of(r.country)),node('p',(r.enabled?'已開放':'未開放')+' · '+(r.fee===null?'運費待確認':'每筆 NT$'+r.fee.toLocaleString())),node('p',r.note),button('編輯',()=>edit(r)));view.append(c);}}
 await load();return true;
}
