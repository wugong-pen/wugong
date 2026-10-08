import {collectionCategories} from './homepage-collections.js';
import {upload} from './admin-home-media.js';
export function renderCollectionsEditor({parent,draft,node,field,button,changed,run,message,api}){
 const root=node('section');root.id='collections-editor';parent.append(root);
 function draw(){
  root.replaceChildren(node('h2','作品系列：圖文與商品連結'),node('p','分為手工鋼筆、手工墨水、工藝收藏。可標示最新商品、年度商品或突破性商品；挑選對應商品後可另換圖片與介紹。修改後按「儲存首頁」才會發布。'));
  for(const [category,label]of Object.entries(collectionCategories)){
   const group=node('fieldset');group.append(node('legend',label));root.append(group);
   const search=field(group,'搜尋要展示的商品','','text',()=>{}, {maxLength:100}),results=node('div');let page=1;
   const load=()=>run(async()=>{const d=await api('/api/admin/products?'+new URLSearchParams({q:search.value,page}));results.replaceChildren();for(const p of d.products.filter(p=>p.active&&p.category===category))results.append(button('新增：'+p.name+'／'+p.variant,()=>{
    if((draft.collections?.length||0)>=30){message('作品最多 30 筆');return;}
    draft.collections??=[];draft.collections.push({category,title:p.name,titleEn:p.english?.name||'',description:p.description||'',descriptionEn:p.english?.description||'',badge:'最新商品',badgeEn:'New arrival',sku:p.sku,image:p.images?.[0]?'/'+p.images[0].replace(/^\//,''):'',enabled:true});draw();changed();
   }));if(!results.children.length)results.append(node('p','本頁沒有符合此分類的上架商品，可調整搜尋或翻頁。'));if(page>1)results.append(button('上一頁',()=>{page--;load();}));if(d.hasMore)results.append(button('下一頁',()=>{page++;load();}));});
   group.append(button('搜尋／選擇商品以新增圖文',()=>{page=1;load();}),results);
   for(const [index,item] of (draft.collections||[]).entries())if(item.category===category){
    const box=node('div');box.className='home-media-block';group.append(box);box.append(node('h3',item.title),node('p','連結商品代碼：'+item.sku));
    const img=node('img');img.className='home-photo';img.alt=item.title;if(item.image)img.src=item.image;box.append(img);
    const file=field(box,'上傳展示圖片','','file',()=>{}, {accept:'image/jpeg,image/png,image/webp'});file.onchange=()=>{const f=file.files[0];if(f)run(async()=>{item.image=await upload(f);img.src=item.image;changed();message('圖片已加入，請儲存首頁。');}).finally(()=>file.value='');};
    for(const [key,label,max,type] of [['title','作品標題',120,'text'],['description','作品介紹',2000,'textarea'],['badge','展示標示（例如：2026 年度商品）',60,'text'],['titleEn','英文標題（選填）',200,'text'],['descriptionEn','英文介紹（選填）',4000,'textarea'],['badgeEn','英文標示（選填）',100,'text']])field(box,label,item[key],type,v=>item[key]=v,{maxLength:max});
    field(box,'顯示狀態',String(item.enabled),'select',v=>item.enabled=v==='true',{choices:[['true','顯示'],['false','隱藏']]});
    box.append(button('上移',()=>{const prev=draft.collections.map((c,i)=>c.category===category&&i<index?i:-1).filter(i=>i>=0).pop();if(prev!==undefined){[draft.collections[prev],draft.collections[index]]=[item,draft.collections[prev]];draw();changed();}}),button('下移',()=>{const next=draft.collections.findIndex((c,i)=>i>index&&c.category===category);if(next>=0){[draft.collections[next],draft.collections[index]]=[item,draft.collections[next]];draw();changed();}}),button('移除展示（不刪除商品）',()=>{draft.collections.splice(index,1);draw();changed();}));
   }
  }
 }draw();
}
