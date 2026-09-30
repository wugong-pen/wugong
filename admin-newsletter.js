import {blankNewsletter,newsletterAudiences,newsletterContent} from './newsletter-model.js';
export async function init({api,node,message}){
 if(new URLSearchParams(location.search).get('section')!=='newsletter')return false;
 document.getElementById('heading').textContent='買家電子報';
 const view=document.getElementById('manage-view'),editor=document.getElementById('editor');let page=1;
 const states={draft:'草稿',sending:'分批寄送中',finished:'寄送處理完成'},delivery={waiting:'等待排入寄送',queued:'等待寄送／重試中',sent:'寄信服務已接受',cancelled:'已停止寄送',attention:'需要人工核對'};
 const button=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(e=>message(e.message));return b;};
 const field=(root,label,value='',type='text',max=6000)=>{const l=node('label',label),el=node(type==='textarea'?'textarea':'input');if(type!=='textarea')el.type=type;el.value=value;el.maxLength=max;l.append(el);root.append(l);return el;};
 async function load(){
  const d=await api('/api/admin/newsletters?page='+page);view.replaceChildren();
  view.append(node('p','自行撰寫活動、新品與品牌消息。先儲存草稿、預覽，再確認寄出。既有會員不會自動訂閱；寄送僅限已訂閱、信箱已驗證且已有出貨或完成訂單的有效會員（不含模擬付款訂單）。國內／海外依會員資料的國家分類。'),button('＋ 新增電子報',()=>edit(blankNewsletter())));
  if(!d.campaigns.length)view.append(node('p','目前尚無電子報，您可以開始撰寫第一封。'));
  for(const c of d.campaigns){const row=node('section');row.className='manage-form';row.append(node('h2',c.subject),node('p',(states[c.state]||c.state)+' · '+new Date(c.updated_at).toLocaleString('zh-TW')),button(c.state==='draft'?'編輯草稿':'查看寄送紀錄',async()=>edit((await api('/api/admin/newsletters?id='+encodeURIComponent(c.id))).campaign)));view.append(row);}
  const prev=button('上一頁',async()=>{page--;await load();}),next=button('下一頁',async()=>{page++;await load();});prev.disabled=page===1;next.disabled=!d.hasMore;view.append(prev,node('span',' 第 '+page+' 頁 '),next);
 }
 async function edit(entry){
  editor.replaceChildren();const f=node('form');f.className='manage-form';editor.append(f);f.append(node('h2',entry.version?'電子報內容':'新增電子報'),node('p','中英文內容需自行填寫，可擇一或兩者並列。預覽信不會建立買家寄送名單。正式寄出後內容會鎖定。'));
  const subject=field(f,'信件主旨',entry.subject,'text',160);subject.required=true;
  const label=node('label','收件對象'),segment=node('select');for(const [key,text]of Object.entries(newsletterAudiences)){const o=node('option',text);o.value=key;segment.append(o);}segment.value=entry.audience;label.append(segment);f.append(label);
  const zh=field(f,'中文內容',entry.zh,'textarea'),en=field(f,'English content',entry.en,'textarea');
  let image=entry.image;const photo=node('img');photo.alt=entry.imageAlt||'電子報圖片';photo.style.cssText='max-width:100%;max-height:300px;display:block';photo.hidden=!image;if(image)photo.src=image;f.append(photo);
  const imageAlt=field(f,'圖片說明（有圖片時必填）',entry.imageAlt,'text',160),upload=field(f,'上傳宣傳圖片（JPG、PNG、WebP，一張）','','file');upload.accept='image/jpeg,image/png,image/webp';
  const remove=button('移除圖片',()=>{image='';photo.hidden=true;changed();});f.append(remove);
  const link=field(f,'活動或商品網址（選填，HTTPS）',entry.link,'url',1000),linkLabel=field(f,'連結按鈕文字',entry.linkLabel,'text',120);
  const actions=node('div');actions.className='form-actions';const confirmation=node('section'),preview=node('section'),records=node('section');
  const readOnly=entry.state!=='draft';let busy=false,dirty=!entry.version,previewKey=crypto.randomUUID();
  const value=()=>({...entry,subject:subject.value,zh:zh.value,en:en.value,audience:segment.value,image,imageAlt:imageAlt.value,link:link.value,linkLabel:linkLabel.value});
  const contentControls=[subject,segment,zh,en,imageAlt,upload,remove,link,linkLabel];
  let lockedButtons=[];function lock(v){busy=v;if(v){lockedButtons=[...f.querySelectorAll('button')].map(b=>[b,b.disabled]);for(const [b]of lockedButtons)b.disabled=true;}else{for(const [b,disabled]of lockedButtons)if(b.isConnected)b.disabled=disabled;lockedButtons=[];}for(const el of contentControls)el.disabled=v||readOnly;}
  async function run(fn){if(busy)return;lock(true);try{await fn();}catch(e){message(e.message);}finally{lock(false);}}
  const save=button('儲存草稿',()=>run(saveDraft));
  async function saveDraft(){if(!dirty)return;if(!f.reportValidity())throw Error('請確認必填欄位');const d=await api('/api/admin/newsletters','POST',{action:'save',campaign:value()});entry=d.campaign;dirty=false;await load();message('草稿已儲存，尚未寄給買家。');}
  function changed(){dirty=true;confirmation.replaceChildren();previewKey=crypto.randomUUID();}
  for(const el of contentControls)el.addEventListener('input',changed);
  upload.onchange=()=>run(async()=>{
   const file=upload.files[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('請使用小於 20 MB 的 JPG、PNG 或 WebP');
   const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas'),scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();let blob;
   for(const quality of [.88,.72,.55]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=1048576)break;}if(!blob||blob.size>1048576)throw Error('圖片過大，請使用較小圖片');
   const r=await fetch('/api/admin/images',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob}),d=await r.json();if(!r.ok)throw Error(d.error||'上傳失敗');image=d.url;photo.src=image;photo.hidden=false;upload.value='';changed();message('圖片已上傳，請儲存草稿。');
  });
  actions.append(save,button('畫面預覽',()=>{preview.replaceChildren();const frame=node('iframe');frame.title='電子報內容預覽';frame.setAttribute('sandbox','');frame.style.cssText='width:100%;height:680px;border:1px solid #75654c;margin-top:20px';frame.srcdoc=newsletterContent(value(),location.origin,'',true).html;preview.append(frame);frame.scrollIntoView({behavior:'smooth'});}));
  const previewEmail=field(f,'預覽收件 Email（只寄一封）','','email',254);
  actions.append(button('寄送預覽信',()=>run(async()=>{if(!previewEmail.value||!previewEmail.reportValidity())throw Error('請填寫預覽收件 Email');if(!readOnly)await saveDraft();await api('/api/admin/newsletters','POST',{action:'preview',id:entry.id,email:previewEmail.value.trim(),key:previewKey});message('預覽信已排入寄送，請更新寄送紀錄查看結果。');await history(1);})),button('確認收件人數並準備寄出',()=>run(async()=>{
   await saveDraft();const d=await api('/api/admin/newsletters','POST',{action:'prepare',id:entry.id,version:entry.version});confirmation.replaceChildren();confirmation.className='manage-form';confirmation.append(node('h3','寄出前確認'),node('p','主旨：'+d.subject),node('p','對象：'+newsletterAudiences[d.audience]+'；共 '+d.count+' 位買家。寄出後不能收回，內容將鎖定。'),button('確認寄出給 '+d.count+' 位買家',()=>run(async()=>{await api('/api/admin/newsletters','POST',{action:'send',id:entry.id,token:d.token});message('已開始分批寄送，請查看紀錄。');await load();await edit((await api('/api/admin/newsletters?id='+entry.id)).campaign);})),button('返回修改',()=>confirmation.replaceChildren()));confirmation.scrollIntoView({behavior:'smooth'});
  })));
  f.append(actions,confirmation,preview,records);
  if(readOnly){save.hidden=true;actions.lastElementChild.hidden=true;actions.append(button('複製為新草稿',()=>edit({...entry,id:crypto.randomUUID(),version:0,state:'draft'})));}
  actions.append(button('關閉編輯',()=>editor.replaceChildren()));
  async function history(p){
   const d=await api('/api/admin/newsletters?'+new URLSearchParams({id:entry.id,page:p}));records.replaceChildren();records.className='manage-form';records.append(node('h3','寄送紀錄'),node('p','「寄信服務已接受」不代表已進入收件匣；需人工核對的紀錄不會自動重新寄送。'),node('p',d.counts.map(x=>(delivery[x.state]||x.state)+'：'+x.total).join(' / ')||'尚未寄給買家。'),button('更新寄送紀錄',()=>history(p)));
   for(const r of d.previews)records.append(node('p','預覽信：'+delivery[r.state]+(r.sent_at?' · '+new Date(r.sent_at).toLocaleString('zh-TW'):'')+(r.last_error?' · '+r.last_error:'')));
   for(const r of d.records)records.append(node('p',r.email+' · '+delivery[r.state]+(r.last_error?' · '+r.last_error:'')));
   const prev=button('紀錄上一頁',()=>history(p-1)),next=button('紀錄下一頁',()=>history(p+1));prev.disabled=p===1;next.disabled=!d.hasMore;records.append(prev,next);
  }
  f.onsubmit=e=>{e.preventDefault();if(!readOnly)run(saveDraft);};lock(false);if(entry.version)await history(1);f.scrollIntoView({behavior:'smooth',block:'start'});
 }
 await load();return true;
}
