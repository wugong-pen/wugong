import {youtubeId} from './content-model.js';
async function upload(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('請選擇 20 MB 以內的 JPG、PNG 或 WebP');
 const bitmap=await createImageBitmap(file),scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();let blob;
 for(const quality of [.9,.75,.6,.45]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=1048576)break;}if(!blob||blob.size>1048576)throw Error('照片縮圖後仍太大，請改用較小的照片');
 const r=await fetch('/api/admin/images',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob}),d=await r.json();if(!r.ok)throw Error(d.error||'照片上傳失敗');return d.url;
}
export function renderMediaEditor({parent,draft,node,field,button,changed,run,message}){
 draft.media??=[];const root=node('section');root.id='homepage-media-editor';parent.append(root);
 const safeButton=(label,fn)=>button(label,()=>{try{fn();}catch(e){message(e.message);}});
 function draw(){root.replaceChildren(node('h2','首頁幻燈片照片組與 YouTube 影片'),node('p','可新增最多 10 組，依下方順序顯示在首頁主視覺之後。每組最多 12 張照片，合計最多 36 張。修改後請按「儲存首頁」。'));
  const controls=node('div');controls.className='form-actions';controls.append(safeButton('＋ 新增幻燈片照片組',()=>{if(draft.media.length>=10)throw Error('首頁最多 10 組');draft.media.push({type:'slideshow',title:'',autoplay:true,interval:5,photos:[]});draw();changed();}));root.append(controls);
  const link=field(root,'首頁 YouTube 網址或嵌入程式碼','','textarea',()=>{}, {maxLength:4000});root.append(safeButton('＋ 加入首頁 YouTube 影片',()=>{if(draft.media.length>=10)throw Error('首頁最多 10 組');draft.media.push({type:'youtube',title:'',id:youtubeId(link.value)});draw();changed();}));
  for(const [index,block]of draft.media.entries()){
   const box=node('div');box.className='home-media-block';box.append(node('h3',`${index+1}. ${block.type==='slideshow'?'幻燈片照片組':'YouTube 影片'}`));field(box,'組別標題（選填）',block.title,'text',v=>block.title=v,{maxLength:120});
   if(block.type==='youtube'){
    const input=field(box,'YouTube 網址或嵌入程式碼','https://www.youtube.com/watch?v='+block.id,'textarea',()=>{}, {maxLength:4000});box.append(safeButton('更新這組影片',()=>{block.id=youtubeId(input.value);changed();message('影片已更新供預覽，請儲存首頁。');}));
   }else{
    field(box,'自動輪播',String(block.autoplay),'select',v=>block.autoplay=v==='true',{choices:[['true','開啟'],['false','關閉（手動切換）']]});field(box,'每張照片停留秒數',block.interval,'number',v=>block.interval=v,{min:3,max:15});
    const photos=node('div');photos.className='home-media-photos';box.append(photos);
    for(const [i,photo]of block.photos.entries()){const card=node('div');card.className='home-media-photo';const img=node('img');img.src=photo.src;img.alt=photo.caption||'幻燈片照片 '+(i+1);card.append(img);field(card,'照片 '+(i+1)+' 說明',photo.caption,'text',v=>photo.caption=v,{maxLength:200});const actions=node('div');actions.className='form-actions';if(i)actions.append(safeButton('照片向前',()=>{[block.photos[i-1],block.photos[i]]=[block.photos[i],block.photos[i-1]];draw();changed();}));if(i<block.photos.length-1)actions.append(safeButton('照片向後',()=>{[block.photos[i+1],block.photos[i]]=[block.photos[i],block.photos[i+1]];draw();changed();}));actions.append(safeButton('移除照片',()=>{block.photos.splice(i,1);draw();changed();}));card.append(actions);photos.append(card);}
    if(!block.photos.length)box.append(node('p','請先上傳至少一張照片，才能儲存這組幻燈片。'));
    const files=field(box,'加入這組照片（可多選，最多 20 MB／張）','','file',()=>{}, {accept:'image/jpeg,image/png,image/webp'});files.multiple=true;files.onchange=()=>{const selected=[...files.files];if(!selected.length)return;run(async()=>{const count=draft.media.reduce((n,b)=>n+(b.photos?.length||0),0);if(block.photos.length+selected.length>12||count+selected.length>36)throw Error('每組最多 12 張，首頁合計最多 36 張');for(const file of selected){const src=await upload(file);block.photos.push({src,caption:''});changed();}draw();message('幻燈片照片已加入，請儲存首頁以套用。');}).finally(()=>{files.value='';draw();});};
   }
   const actions=node('div');actions.className='form-actions';if(index)actions.append(safeButton('整組上移',()=>{[draft.media[index-1],draft.media[index]]=[draft.media[index],draft.media[index-1]];draw();changed();}));if(index<draft.media.length-1)actions.append(safeButton('整組下移',()=>{[draft.media[index+1],draft.media[index]]=[draft.media[index],draft.media[index+1]];draw();changed();}));actions.append(safeButton('移除此組',()=>{draft.media.splice(index,1);draw();changed();}));box.append(actions);root.append(box);
  }
 }draw();
}
