import {collectionCategories,validateCollections} from './homepage-collections.js';
import {registerTranslation} from './i18n.js';
let originalCards;
export function renderCollections(value){
 const root=document.querySelector('#collections .cards');if(!root)return;
 originalCards??=[...root.childNodes].map(n=>n.cloneNode(true));
 if(value===undefined){root.replaceChildren(...originalCards.map(n=>n.cloneNode(true)));root.style.display='';return;}
 const items=validateCollections(value);
 root.replaceChildren();root.style.display='block';
 registerTranslation('查看商品','View product');registerTranslation('瀏覽此分類','Browse collection');registerTranslation('作品陸續更新中','New works coming soon');
 for(const [category,label] of Object.entries(collectionCategories)){
  const section=document.createElement('section');section.className='collection-group';
  const heading=document.createElement('h3');heading.textContent=label;section.append(heading);
  const grid=document.createElement('div');grid.className='collection-showcase';section.append(grid);
  const selected=items.filter(i=>i.category===category&&i.enabled);
  for(const item of selected){
   for(const key of ['title','description','badge'])if(item[key+'En'])registerTranslation(item[key],item[key+'En']);
   const card=document.createElement('article');card.className='card';
   const img=document.createElement('img');img.src=item.image;img.alt=item.title;img.loading='lazy';card.append(img);
   for(const [tag,key] of [['span','badge'],['h4','title'],['p','description']])if(item[key]){const el=document.createElement(tag);el.textContent=item[key];card.append(el);}
   const a=document.createElement('a');a.className='btn';a.href='/product.html?'+new URLSearchParams({sku:item.sku});a.textContent='查看商品';card.append(a);grid.append(card);
  }
  if(!selected.length){const p=document.createElement('p');p.textContent='作品陸續更新中';section.append(p);}
  const link=document.createElement('a');link.href='/shop.html?category='+category;link.textContent='瀏覽此分類';section.append(link);root.append(section);
 }
}
