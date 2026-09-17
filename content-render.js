import {contentKinds,sourceURL,imagePath,youtubeId} from './content-model.js';
const node=(tag,value)=>{const el=document.createElement(tag);el.textContent=value??'';return el;};
export function renderArticle(root,entry){
 root.replaceChildren();root.className='content-article';
 root.append(node('p',contentKinds[entry.kind]),node('h1',entry.title));const time=node('time',entry.date);time.dateTime=entry.date;root.append(time);
 if(entry.summary){const p=node('p',entry.summary);p.className='content-summary';root.append(p);}
 function image(src,caption,cover=false){if(!imagePath(src))return;const figure=node('figure'),img=node('img');img.src=src;img.alt=caption||entry.title;img.loading=cover?'eager':'lazy';img.decoding='async';figure.append(img);if(caption)figure.append(node('figcaption',caption));root.append(figure);}
 if(entry.cover)image(entry.cover,'',true);
 for(const b of entry.blocks){if(b.type==='text'){const p=node('p',b.text);p.className='content-paragraph';root.append(p);}else if(b.type==='image')image(b.src,b.caption);else if(b.type==='youtube'){const figure=node('figure'),frame=node('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+youtubeId(b.id);frame.title=b.caption||entry.title+'影片';frame.loading='lazy';frame.allow='encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';frame.className='content-video';figure.append(frame);if(b.caption)figure.append(node('figcaption',b.caption));root.append(figure);}}
 if(entry.source){const p=node('p'),a=node('a','閱讀原始報導／相關連結 ↗');a.href=sourceURL(entry.source);a.target='_blank';a.rel='noopener noreferrer';p.append(a);root.append(p);}
}
