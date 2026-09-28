import {guideFields} from './nib-guide-model.js';
const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text||'';return n;};
export function renderGuide(root,entry,english=false){
 const card=node('article');card.className='nib-guide-card';card.setAttribute('translate','no');
 function copy(key){const value=english?entry.en[key]||entry.zh[key]:entry.zh[key];return {value,missing:english&&!entry.en[key]&&!!entry.zh[key]};}
 const name=copy('name'),h=node('h2',name.value);h.lang=name.missing?'zh-Hant':english?'en':'zh-Hant';card.append(h);
 if(english&&guideFields.some(([k])=>entry.zh[k]&&!entry.en[k]))card.append(node('p','Some English details are not yet available. Original Chinese text is shown below; please email wugong.pen@gmail.com for help.'));
 const dl=node('dl');for(const [k,zh,en]of guideFields.slice(1)){const {value,missing}=copy(k);if(!value)continue;const dd=node('dd',value);dd.lang=missing?'zh-Hant':english?'en':'zh-Hant';dl.append(node('dt',english?en:zh),dd);}card.append(dl);
 for(const p of entry.photos){const figure=node('figure'),img=node('img');img.src=p.src;img.alt=(english?p.en||p.zh:p.zh)||name.value;img.loading='lazy';figure.append(img);const caption=english?p.en||p.zh:p.zh;if(caption)figure.append(node('figcaption',caption));card.append(figure);}root.append(card);return card;
}
