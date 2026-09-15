export async function init({api,node,message}){
 const section=new URLSearchParams(location.search).get('section'),view=document.getElementById('manage-view'),editor=document.getElementById('editor');
 if(!['stock','nibs','coupons'].includes(section))return false;
 document.getElementById('heading').textContent={stock:'筆款共用庫存與影片',nibs:'尖型管理',coupons:'優惠券管理'}[section];
 const button=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=()=>Promise.resolve(fn()).catch(e=>message(e.message));return b;};
 function field(f,label,value='',type='text'){const l=node('label',label),i=node(type==='textarea'?'textarea':'input');if(type!=='textarea')i.type=type;i.value=value;l.append(i);f.append(l);return i;}
 function select(f,label,value,options){const l=node('label',label),i=node('select');for(const [v,t]of options){const o=node('option',t);o.value=v;i.append(o);}i.value=value;l.append(i);f.append(l);return i;}
 function form(title){editor.replaceChildren();const f=node('form');f.className='manage-form';f.append(node('h2',title));editor.append(f);f.scrollIntoView({behavior:'smooth'});return f;}
 function submit(f,fn){const b=node('button','儲存設定');b.type='submit';f.append(b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await fn();editor.replaceChildren();await load();message('設定已儲存。');}catch(e){message(e.message);}finally{b.disabled=false;}};}
 function card(title,detail,fn){const c=node('section');c.className='manage-form';c.append(node('h2',title),node('p',detail),button('管理',fn));view.append(c);}
 async function stock(p){const f=form(p.name+'｜共用筆身');f.append(node('p',p.confirmed?`可售 ${p.available} 件，已售 ${p.sold} 件。各尖型共用此數量。`:`待核對：舊規格庫存合計 ${p.legacy_available}，僅供查閱，不能視為筆身數量。請填入實際可售筆身數量，排除未完成訂單已保留的筆身。`));
  const delta=field(f,p.confirmed?'增減數量（入庫正數、盤損負數）':'實際可售筆身數量',0,'number');delta.min=p.confirmed?-100000:0;delta.max=100000;
  const reason=field(f,'庫存核對／異動原因','','textarea'),threshold=field(f,'低庫存提醒門檻',p.threshold,'number');threshold.min=0;threshold.max=100000;
  const video=field(f,'YouTube 網址或嵌入碼',p.video?'https://youtu.be/'+p.video:'','textarea');
  submit(f,()=>api('/api/admin/family','POST',{family:p.family,version:p.version,expected:p.available,delta:Number(delta.value),reason:reason.value,threshold:Number(threshold.value),video:video.value,confirm:true}));
 }
 function nib(p={name:'',active:1}){const f=form('尖型設定'),name=field(f,'尖型名稱',p.name);name.required=true;name.maxLength=100;name.readOnly=!!p.name;const active=select(f,'是否供商品選用',String(p.active),[['1','啟用'],['0','停用']]);f.append(node('p','停用後不供新訂單選擇，舊訂單規格保留。要使用不同名稱，請新增尖型後再設定商品。'));submit(f,()=>api('/api/admin/nibs','POST',{name:name.value,active:Number(active.value)}));}
 const localDate=v=>{const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 async function coupon(p={code:'',kind:'fixed',amount:100,minimum:1000,maximum:100,scope:'all',target:'',starts:new Date().toISOString(),ends:new Date(Date.now()+30*86400000).toISOString(),quota:100,active:0,version:0}){
  const f=form('優惠券設定'),code=field(f,'折扣碼',p.code);code.required=true;code.readOnly=!!p.version;
  const kind=select(f,'折抵方式',p.kind,[['fixed','固定金額'],['percent','百分比折抵（10 表示折抵 10%，即九折）']]),amount=field(f,'折抵金額／百分比',p.amount,'number'),minimum=field(f,'適用商品最低消費金額',p.minimum,'number'),maximum=field(f,'最高折抵金額',p.maximum,'number');
  const scope=select(f,'適用範圍',p.scope,[['all','全部商品'],['family','指定商品'],['category','指定分類']]);const families=(await api('/api/admin/families')).families;
  const target=select(f,'適用商品／分類',p.target,[['','全部'],['pen','分類：手工鋼筆'],['ink','分類：手工墨水'],['craft','分類：工藝收藏'],...families.map(x=>[x.family,'商品：'+x.name])]);
  const starts=field(f,'開始時間（本地時間）',localDate(p.starts),'datetime-local'),ends=field(f,'結束時間（本地時間）',localDate(p.ends),'datetime-local'),quota=field(f,'總使用名額',p.quota,'number'),active=select(f,'狀態',String(p.active),[['0','停用／草稿'],['1','啟用']]);
  f.append(node('p','每筆訂單限一張；每位會員同一張券限一次。僅折抵適用商品，不含運費；未付款保留名額，逾期釋放。折抵後須至少 NT$1。'));
  submit(f,()=>api('/api/admin/coupon','POST',{code:code.value,kind:kind.value,amount:Number(amount.value),minimum:Number(minimum.value),maximum:Number(maximum.value),scope:scope.value,target:target.value,starts:new Date(starts.value).toISOString(),ends:new Date(ends.value).toISOString(),quota:Number(quota.value),active:Number(active.value),version:p.version}));
  if(p.version){f.append(node('h3','使用／保留紀錄'));const {claims}=await api('/api/admin/coupon?code='+encodeURIComponent(p.code));for(const r of claims){const a=node('a',r.order_number+'｜會員 '+r.member_id+'｜折抵 NT$'+r.discount+'｜'+r.status);a.href='/admin-order-detail.html?order='+encodeURIComponent(r.order_number);const row=node('p');row.append(a);f.append(row);}}
 }
 async function load(){view.replaceChildren();message('');if(section==='stock'){const {families}=await api('/api/admin/families');view.append(node('p','每個筆款只有一筆共用庫存；舊庫存須核對後才開放購買。'));for(const p of families)card(p.name,(!p.confirmed?'⚠ 待核對庫存':p.available<=p.threshold?'⚠ 低庫存':'庫存正常')+'｜可售 '+p.available+'｜提醒門檻 '+p.threshold,()=>stock(p));}
  if(section==='nibs'){view.append(button('＋ 新增尖型',()=>nib()));for(const p of (await api('/api/admin/nibs')).nibs)card(p.name,p.active?'啟用':'停用',()=>nib(p));}
  if(section==='coupons'){view.append(button('＋ 新增優惠券',()=>coupon()));for(const p of (await api('/api/admin/coupons')).coupons)card(p.code,(p.active?'啟用':'停用')+'｜已使用或保留 '+p.used+'/'+p.quota,()=>coupon(p));}
 }await load();return true;
}
