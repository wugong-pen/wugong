import {youtubeId} from './content-model.js';
export async function init({api,node,message}){
 const section=new URLSearchParams(location.search).get('section'),view=document.getElementById('manage-view'),editor=document.getElementById('editor');
 if(!['stock','nibs','coupons','categories'].includes(section))return false;
 document.getElementById('heading').textContent={stock:'筆款共用庫存與影片',nibs:'尖型管理',coupons:'優惠券管理',categories:'品牌／商品分類'}[section];
 const button=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=async()=>{try{await fn();}catch(e){message(e.message);}};return b;};
 function field(f,label,value='',type='text'){const l=node('label',label),i=node(type==='textarea'?'textarea':'input');if(type!=='textarea')i.type=type;i.value=value;l.append(i);f.append(l);return i;}
 function select(f,label,value,options){const l=node('label',label),i=node('select');for(const [v,t]of options){const o=node('option',t);o.value=v;i.append(o);}i.value=value;l.append(i);f.append(l);return i;}
 function form(title){editor.replaceChildren();const f=node('form');f.className='manage-form';f.append(node('h2',title));editor.append(f);f.scrollIntoView({behavior:'smooth'});return f;}
 function submit(f,fn){const b=node('button','儲存設定');b.type='submit';f.append(b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await fn();editor.replaceChildren();await load();message('設定已儲存。');}catch(e){message(e.message);}finally{b.disabled=false;}};}
 function card(title,detail,fn){const c=node('section');c.className='manage-form';c.append(node('h2',title),node('p',detail),button('管理',fn));view.append(c);}
 async function stock(p){const f=form(p.name+'｜共用筆身');f.append(node('p',p.confirmed?`可售 ${p.available} 件，已售 ${p.sold} 件。各尖型共用此數量。`:`待核對：舊規格庫存合計 ${p.legacy_available}，僅供查閱，不能視為筆身數量。請填入實際可售筆身數量，排除未完成訂單已保留的筆身。`));
  const delta=field(f,p.confirmed?'增減數量（入庫正數、盤損負數）':'實際可售筆身數量',0,'number');delta.min=p.confirmed?-100000:0;delta.max=100000;
  const reason=field(f,'庫存核對／異動原因','','textarea'),threshold=field(f,'低庫存提醒門檻',p.threshold,'number');threshold.min=0;threshold.max=100000;
  const video=field(f,'YouTube 網址或嵌入碼',p.video?'https://youtu.be/'+p.video:'','textarea');video.maxLength=4000;
  f.append(node('p','影片會直接嵌入商品頁播放。貼上 YouTube 分享網址或 iframe 嵌入程式碼即可；若只更新影片，庫存增減填 0，原因填「更新商品影片」。'));
  const videoPreview=node('div');f.append(button('預覽商品影片',()=>{videoPreview.replaceChildren();if(!video.value.trim())return;const frame=node('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+youtubeId(video.value);frame.title='商品影片預覽';frame.allowFullscreen=true;frame.allow='encrypted-media; picture-in-picture; fullscreen';frame.referrerPolicy='strict-origin-when-cross-origin';frame.style.cssText='width:100%;aspect-ratio:16/9;border:0';videoPreview.append(frame);}),videoPreview);
  submit(f,()=>api('/api/admin/family','POST',{family:p.family,version:p.version,expected:p.available,delta:Number(delta.value),reason:reason.value,threshold:Number(threshold.value),video:video.value,confirm:true}));
 }
 function nib(p={name:'',active:1}){const f=form('尖型設定'),name=field(f,'尖型名稱',p.name);name.required=true;name.maxLength=100;name.readOnly=!!p.name;const active=select(f,'是否供商品選用',String(p.active),[['1','啟用'],['0','停用']]);f.append(node('p','停用後不供新訂單選擇，舊訂單規格保留。要使用不同名稱，請新增尖型後再設定商品。'));submit(f,()=>api('/api/admin/nibs','POST',{name:name.value,active:Number(active.value)}));}
 const localDate=v=>{const d=new Date(v);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 async function coupon(p={code:'',kind:'fixed',amount:100,minimum:1000,maximum:100,scope:'all',target:'',starts:new Date().toISOString(),ends:new Date(Date.now()+30*86400000).toISOString(),quota:100,active:0,version:0}){
  const f=form('優惠券設定'),code=field(f,'折扣碼',p.code);code.required=true;code.readOnly=!!p.version;
  const kind=select(f,'折抵方式',p.kind,[['fixed','固定金額'],['percent','百分比折抵（10 表示折抵 10%，即九折）'],['gift','贈送商品']]),amount=field(f,'折抵金額／百分比',p.amount,'number'),minimum=field(f,'適用商品最低消費金額',p.minimum,'number'),maximum=field(f,'最高折抵金額',p.maximum,'number');
  const giftText=field(f,'贈品／優惠說明（例如：贈送 wugong 墨水 1 瓶）',p.gift_text||'','textarea');giftText.maxLength=500;
  const giftKind=select(f,'贈品類型',p.gift_kind||'other',[['other','其他贈品'],['ink','墨水（僅寄送台灣）']]);
  function limits(){const gift=kind.value==='gift';amount.min=gift?0:1;maximum.min=gift?0:1;amount.max=kind.value==='percent'?100:10000000;giftText.required=gift;if(gift){amount.value=0;maximum.value=0;}giftKind.parentElement.hidden=!gift;}
  kind.onchange=limits;limits();
  f.append(node('p','贈品券折抵金額及最高折抵金額填 0。贈品說明會記錄於訂單，請人工備貨；不會自動扣除贈品庫存。墨水贈品須選擇墨水類型，海外訂單不可使用。'));
  const categories=(await api('/api/admin/categories')).categories;
  const scope=select(f,'適用範圍',p.scope,[['all','全部商品'],['family','指定商品'],['category','指定分類']]);const families=(await api('/api/admin/families')).families;
  const target=select(f,'適用商品／分類',p.target,[['','全部'],['pen','分類：手工鋼筆'],['ink','分類：手工墨水'],['craft','類型：其他商品'],...categories.map(c=>[c.id,(c.parent?'分類：'+(categories.find(b=>b.id===c.parent)?.name||'')+'／':'品牌：')+c.name]),...families.map(x=>[x.family,'商品：'+x.name])]);
  const starts=field(f,'開始時間（本地時間）',localDate(p.starts),'datetime-local'),ends=field(f,'結束時間（本地時間）',localDate(p.ends),'datetime-local'),quota=field(f,'總使用名額',p.quota,'number'),active=select(f,'狀態',String(p.active),[['0','停用／草稿'],['1','啟用']]);
  f.append(node('p','每筆訂單限一張；每位會員同一張券限一次。僅折抵適用商品，不含運費；未付款保留名額，逾期釋放。折抵後須至少 NT$1。'));
  submit(f,()=>api('/api/admin/coupon','POST',{code:code.value,kind:kind.value,gift_text:giftText.value,gift_kind:giftKind.value,amount:Number(amount.value),minimum:Number(minimum.value),maximum:Number(maximum.value),scope:scope.value,target:target.value,starts:new Date(starts.value).toISOString(),ends:new Date(ends.value).toISOString(),quota:Number(quota.value),active:Number(active.value),version:p.version}));
  if(p.version){f.append(node('h3','使用／保留紀錄'));const {claims}=await api('/api/admin/coupon?code='+encodeURIComponent(p.code));for(const r of claims){const a=node('a',r.order_number+'｜會員 '+r.member_id+'｜折抵 NT$'+r.discount+'｜'+r.status);a.href='/admin-order-detail.html?order='+encodeURIComponent(r.order_number);const row=node('p');row.append(a);f.append(row);}}
 }
 async function category(p={id:'',name:'',parent:'',kind:'pen',version:0}){
  const categories=(await api('/api/admin/categories')).categories,f=form(p.version?'編輯品牌／分類':'新增品牌／分類');
  const name=field(f,'名稱',p.name);name.required=true;name.maxLength=100;
  const parent=select(f,'所屬品牌（選新增品牌可建立品牌項目）',p.parent||'',[['','新增品牌'],...categories.filter(c=>!c.parent).map(c=>[c.id,c.name])]);
  const kind=select(f,'商品類型',p.kind||'pen',[['pen','鋼筆（選擇尖型）'],['ink','墨水（僅寄送台灣）'],['craft','其他商品（筆記本、工藝收藏等）']]);
  parent.disabled=kind.disabled=!!p.version;const toggle=()=>kind.parentElement.hidden=!parent.value;parent.onchange=toggle;toggle();
  f.append(node('p','品牌下可新增多個分類。儲存後會自動建立分類商品列表網址；商品在商品管理中選擇此分類。商品類型用於尖型選單與墨水寄送限制。'));
  submit(f,()=>api('/api/admin/categories','POST',{id:p.id,name:name.value,parent:parent.value,kind:kind.value,version:p.version}));
 }
 async function load(){view.replaceChildren();message('');if(section==='stock'){const {families}=await api('/api/admin/families');view.append(node('p','每個筆款只有一筆共用庫存；舊庫存須核對後才開放購買。'));for(const p of families)card(p.name,(!p.confirmed?'⚠ 待核對庫存':p.available<=p.threshold?'⚠ 低庫存':'庫存正常')+'｜可售 '+p.available+'｜提醒門檻 '+p.threshold,()=>stock(p));}
  if(section==='categories'){view.append(button('＋ 新增品牌／分類',()=>category()));const {categories}=await api('/api/admin/categories');for(const b of categories.filter(c=>!c.parent)){card(b.name,'品牌',()=>category(b));for(const c of categories.filter(c=>c.parent===b.id)){card(b.name+'／'+c.name,({pen:'鋼筆',ink:'墨水',craft:'其他商品'})[c.kind],()=>category(c));const a=node('a','查看前台分類頁');a.href='/shop.html?category='+encodeURIComponent(c.id);a.target='_blank';a.rel='noopener';view.append(a);}}}
  if(section==='nibs'){view.append(button('＋ 新增尖型',()=>nib()));for(const p of (await api('/api/admin/nibs')).nibs)card(p.name,p.active?'啟用':'停用',()=>nib(p));}
  if(section==='coupons'){view.append(button('＋ 新增優惠券',()=>coupon()));for(const p of (await api('/api/admin/coupons')).coupons)card(p.code,(p.active?'啟用':'停用')+'｜已使用或保留 '+p.used+'/'+p.quota,()=>coupon(p));}
 }await load();return true;
}
