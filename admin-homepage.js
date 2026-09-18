import {defaults,textFields,validateHomepage} from './homepage-config.js';
import {renderMediaEditor} from './admin-home-media.js';
export async function init({api,node,message}){
 if(new URLSearchParams(location.search).get('section')!=='homepage')return false;
 document.getElementById('heading').textContent='首頁編輯';
 const view=document.getElementById('manage-view');
 message('正在讀取首頁設定…');
 const initial=await api('/api/admin/homepage');initial.config.media??=[];initial.config.logo??=defaults().logo;let saved=structuredClone(initial.config),draft=structuredClone(saved),version=initial.version,dirty=false,busy=false;
 const mediaStyle=node('link');mediaStyle.rel='stylesheet';mediaStyle.href='/homepage-media.css';document.head.append(mediaStyle);
 const intro=node('p','先修改並預覽，按「儲存首頁」後才會套用到目前網站。字體大小為電腦版上限，大字在手機上會自動縮小。');view.append(intro);
 const actions=node('div');actions.className='form-actions home-actions';const status=node('span','尚無修改');status.setAttribute('role','status');
 const button=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=fn;return b;};
 const form=node('form');form.className='manage-form';form.id='homepage-form';
 const save=node('button','儲存首頁');save.type='submit';save.setAttribute('form',form.id);
 const discard=button('捨棄未儲存修改',()=>{draft=structuredClone(saved);dirty=false;render();update();message('已還原至上次儲存的內容。');});
 const reset=button('套用原始首頁設定',()=>{draft=defaults();render();changed();message('已載入原始設定供預覽；按儲存才會套用。');});actions.append(save,discard,reset,status);view.append(actions);
 const preview=node('section');preview.className='home-preview';preview.append(node('h2','即時預覽'));
 const sizes=node('div');sizes.className='form-actions';const frame=node('iframe');frame.title='首頁草稿預覽';frame.src='/?homepage-preview=1';frame.className='home-preview-frame';
 const stage=node('div');stage.className='home-preview-stage';let previewWidth=1200;
 function resize(){const scale=Math.min(1,stage.clientWidth/previewWidth);frame.style.width=previewWidth+'px';frame.style.height='800px';frame.style.transform=`scale(${scale})`;frame.style.marginLeft=Math.max(0,(stage.clientWidth-previewWidth*scale)/2)+'px';stage.style.height=800*scale+'px';}
 const desktop=button('電腦預覽',()=>{previewWidth=1200;resize();desktop.setAttribute('aria-pressed','true');phone.setAttribute('aria-pressed','false');});const phone=button('手機預覽',()=>{previewWidth=390;resize();desktop.setAttribute('aria-pressed','false');phone.setAttribute('aria-pressed','true');});desktop.setAttribute('aria-pressed','true');phone.setAttribute('aria-pressed','false');sizes.append(desktop,phone);stage.append(frame);preview.append(sizes,stage);view.append(preview,form);new ResizeObserver(resize).observe(stage);
 function update(){status.textContent=busy?'處理中…':dirty?'有未儲存的修改':'已與儲存內容同步';save.disabled=busy||!dirty;discard.disabled=busy||!dirty;reset.disabled=busy;for(const control of form.querySelectorAll('input,textarea,select,button'))control.disabled=busy;frame.contentWindow?.postMessage({type:'homepage-preview',config:draft},location.origin);}
 function changed(){dirty=JSON.stringify(draft)!==JSON.stringify(saved);update();}
 async function run(fn){if(busy)return;busy=true;update();try{await fn();}catch(e){message(e.message);}finally{busy=false;update();}}
 addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
 addEventListener('message',e=>{if(e.origin===location.origin&&e.source===frame.contentWindow&&e.data?.type==='homepage-ready')update();});
 function field(parent,label,value,type,onchange,options={}){const wrap=node('div'),id='home-'+crypto.randomUUID(),l=node('label',label);l.htmlFor=id;const input=node(type==='textarea'?'textarea':type==='select'?'select':'input');input.id=id;if(type==='select'){for(const [v,label] of options.choices){const o=node('option',label);o.value=v;input.append(o);}}else if(type!=='textarea')input.type=type;
 if(type!=='file')input.value=value;for(const key of ['min','max','maxLength','accept'])if(options[key]!==undefined)input[key]=options[key];if(type==='number')input.required=true;
 input.addEventListener('input',()=>{onchange(type==='number'?Number(input.value):input.value);changed();});wrap.append(l,input);parent.append(wrap);return input;}
 function photo(parent,key,label){
  const box=node('fieldset');box.append(node('legend',label));const img=node('img');img.className='home-photo';img.alt=label;img.hidden=!draft[key];if(draft[key])img.src=draft[key];box.append(img);
  const input=field(box,'上傳 JPG、PNG 或 WebP（原始照片最多 20 MB，自動縮圖）','','file',()=>{}, {accept:'image/jpeg,image/png,image/webp'});
  input.addEventListener('change',async()=>{const file=input.files[0];if(!file||busy)return;busy=true;update();try{
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('請選擇 20 MB 以內的 JPG、PNG 或 WebP 照片');
   const bitmap=await createImageBitmap(file),scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();let blob;
   for(const quality of [.9,.75,.6,.45]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=1048576)break;}
   if(!blob||blob.size>1048576)throw Error('縮圖後仍太大，請換較小的照片');
   const r=await fetch('/api/admin/images',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob}),d=await r.json();if(!r.ok)throw Error(d.error||'照片上傳失敗');draft[key]=d.url;img.src=d.url;img.hidden=false;changed();message('照片已上傳供預覽，請儲存首頁以套用。');
  }catch(e){message(e.message);}finally{busy=false;input.value='';update();}});
  box.append(button('移除'+label,()=>{draft[key]='';img.hidden=true;img.removeAttribute('src');changed();}));parent.append(box);
 }
 function render(){form.replaceChildren();form.append(node('h2','照片與背景'));photo(form,'logo','左上角圓形品牌照片');form.append(node('p','品牌照片會顯示在 WUGONG 旁邊，建議使用正方形照片，主體置中；電腦和手機皆以圓形顯示。'));photo(form,'image','主照片');photo(form,'backgroundImage','頁面背景照片');const grid=node('div');grid.className='form-grid';form.append(grid);
  field(grid,'主照片裁切位置',draft.imagePosition,'select',v=>draft.imagePosition=v,{choices:[['center','置中'],['top','靠上'],['bottom','靠下'],['left','靠左'],['right','靠右']]});
  field(grid,'照片暗色遮罩（0 至 90，越大越暗）',draft.overlay,'number',v=>draft.overlay=v,{min:0,max:90});
  field(grid,'頁面背景顏色',draft.background,'color',v=>draft.background=v);field(grid,'作品系列／工藝介紹區背景',draft.sectionBackground,'color',v=>draft.sectionBackground=v);
  renderMediaEditor({parent:form,draft,node,field,button,changed,run,message});
  form.append(node('h2','文字、字體大小與顏色'));
  for(const [id,label] of textFields){const details=node('details');details.open=['title','subtitle','description'].includes(id);details.append(node('summary',label));const group=node('div');group.className='home-text-group';details.append(group);form.append(details);
   field(group,'文字內容',draft.texts[id].text,'textarea',v=>draft.texts[id].text=v,{maxLength:2000});const row=node('div');row.className='form-grid';group.append(row);
   field(row,'字體',draft.texts[id].font,'select',v=>draft.texts[id].font=v,{choices:[['sans','黑體'],['serif','襯線字體'],['kai','楷體']]});field(row,'字體大小（12 至 120 px）',draft.texts[id].size,'number',v=>draft.texts[id].size=v,{min:12,max:120});field(row,'文字顏色',draft.texts[id].color,'color',v=>draft.texts[id].color=v);
  }
  const bottom=node('button','儲存首頁');bottom.type='submit';form.append(bottom);
 }
 form.onsubmit=async e=>{e.preventDefault();if(busy||!dirty)return;try{validateHomepage(draft);}catch(e){message(e.message);return;}busy=true;update();message('正在儲存首頁…');try{const result=await api('/api/admin/homepage','POST',{config:draft,version});saved=structuredClone(result.config);draft=structuredClone(saved);version=result.version;dirty=false;render();message('首頁已儲存。重新開啟首頁即可看到更新。');}catch(e){message(e.message+'。你的未儲存修改仍保留在此頁。');}finally{busy=false;update();}};
 render();update();message(initial.updatedAt?'上次儲存：'+new Date(initial.updatedAt).toLocaleString('zh-TW'):'尚未自訂首頁，目前使用原始內容。');return true;
}
