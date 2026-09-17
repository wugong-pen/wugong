import {contentKinds} from './content-model.js';import {renderArticle} from './content-render.js';
const $=id=>document.getElementById(id),node=(tag,value)=>{const el=document.createElement(tag);el.textContent=value??'';return el;},params=new URLSearchParams(location.search);
async function api(url){const r=await fetch(url,{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'讀取失敗，請稍後再試');return d;}
async function load(){
 $('content-message').textContent='正在讀取…';
 if(document.body.dataset.contentPage==='article'){
  const {entry}=await api('/api/content-entry?'+new URLSearchParams({id:params.get('id')||''}));renderArticle($('content-article'),entry);document.title=entry.title+'｜WUGONG 吾鋼';$('content-back').href='/content.html?kind='+entry.kind;$('content-back').textContent='← 返回'+contentKinds[entry.kind];$('content-message').textContent='';return;
 }
 const kind=params.get('kind')||'',page=Number(params.get('page')||1);if(kind&&!Object.hasOwn(contentKinds,kind))throw Error('找不到此內容分類');
 const title=contentKinds[kind]||'品牌紀事';$('content-heading').textContent=title;document.title=title+'｜WUGONG 吾鋼';
 for(const [key,label]of [['','全部'],...Object.entries(contentKinds)]){const a=node('a',label);a.href='/content.html'+(key?'?kind='+key:'');if(key===kind)a.setAttribute('aria-current','page');$('content-tabs').append(a);}
 const data=await api('/api/content?'+new URLSearchParams({kind,page}));for(const entry of data.entries){const card=node('article');card.className='content-card';const a=node('a');a.href='/article.html?id='+encodeURIComponent(entry.id);if(entry.cover){const img=node('img');img.src=entry.cover;img.alt='';img.loading='lazy';a.append(img);}else{const cover=node('div','WUGONG');cover.className='content-placeholder';cover.setAttribute('aria-hidden','true');a.append(cover);}const detail=node('div');detail.append(node('p',contentKinds[entry.kind]+' · '+entry.date),node('h2',entry.title),node('p',entry.summary||'閱讀完整內容 →'));a.append(detail);card.append(a);$('content-list').append(card);}
 $('content-message').textContent=data.entries.length?'':page>1?'這一頁沒有內容，請返回上一頁。':'內容正在整理中，敬請期待。';
 const link=(label,p)=>{const a=node('a',label);a.href='/content.html?'+new URLSearchParams({kind,page:p});return a;};if(page>1)$('content-pagination').append(link('← 上一頁',page-1));$('content-pagination').append(node('span','第 '+data.page+' 頁'));if(data.hasMore)$('content-pagination').append(link('下一頁 →',page+1));
}
load().catch(e=>{$('content-message').textContent=e.message;});
