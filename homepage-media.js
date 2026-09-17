import {youtubeId} from './content-model.js';
let previous='',dispose=()=>{};
export function renderHomepageMedia(media=[]){
 const key=JSON.stringify(media);if(previous===key)return;previous=key;dispose();const controller=new AbortController(),timers=[];dispose=()=>{controller.abort();timers.forEach(clearInterval);};
 let root=document.getElementById('homepage-media');if(!root){root=document.createElement('div');root.id='homepage-media';document.getElementById('home').after(root);}root.replaceChildren();
 const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text??'';return el;},listen=(el,type,fn)=>el.addEventListener(type,fn,{signal:controller.signal});
 for(const [index,block]of media.entries()){
  const section=node('section');section.className='homepage-media-section';if(block.title){const h=node('h2',block.title);h.id='home-media-title-'+index;section.append(h);section.setAttribute('aria-labelledby',h.id);}
  if(block.type==='youtube'){const frame=node('iframe');frame.src='https://www.youtube-nocookie.com/embed/'+youtubeId(block.id);frame.title=block.title||'WUGONG 影片 '+(index+1);frame.className='homepage-video';frame.loading='lazy';frame.allow='encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';section.append(frame);}
  else if(block.type==='slideshow'){
   section.setAttribute('role','region');section.setAttribute('aria-roledescription','輪播照片');if(!block.title)section.setAttribute('aria-label','WUGONG 幻燈片 '+(index+1));section.tabIndex=0;
   const figure=node('figure'),photo=node('img'),caption=node('figcaption');photo.className='homepage-slide';photo.loading='lazy';photo.decoding='async';figure.append(photo,caption);section.append(figure);
   let current=0,paused=!block.autoplay||matchMedia('(prefers-reduced-motion: reduce)').matches,hover=false,focus=false;const controls=node('div'),count=node('span');controls.className='homepage-slide-controls';count.setAttribute('aria-live','off');
   const draw=()=>{const p=block.photos[current];photo.src=p.src;photo.alt=p.caption||block.title+' 照片 '+(current+1);caption.textContent=p.caption;caption.hidden=!p.caption;count.textContent=`${current+1} / ${block.photos.length}`;};
   const button=(text,fn)=>{const b=node('button',text);b.type='button';listen(b,'click',fn);return b;};
   if(block.photos.length>1){const pause=button(paused?'播放輪播':'暫停輪播',()=>{paused=!paused;pause.textContent=paused?'播放輪播':'暫停輪播';});const move=delta=>{current=(current+delta+block.photos.length)%block.photos.length;draw();};controls.append(button('← 上一張',()=>move(-1)),count,button('下一張 →',()=>move(1)),pause);listen(section,'keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1);}});listen(section,'mouseenter',()=>hover=true);listen(section,'mouseleave',()=>hover=false);listen(section,'focusin',()=>focus=true);listen(section,'focusout',e=>focus=section.contains(e.relatedTarget));timers.push(setInterval(()=>{if(!paused&&!hover&&!focus&&!document.hidden)move(1);},block.interval*1000));}else controls.append(count);
   section.append(controls);draw();
  }
  root.append(section);
 }
}
