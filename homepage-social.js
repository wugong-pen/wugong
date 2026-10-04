export function socialDefaults(){return {facebook:{url:'https://www.facebook.com/WUGONG.pen',enabled:true},instagram:{url:'',enabled:false}};}
export function validateSocial(value=socialDefaults()){
 const result={};
 for(const name of ['facebook','instagram']){
  const entry=value?.[name];
  if(!entry||typeof entry.enabled!=='boolean'||typeof entry.url!=='string')throw Object.assign(Error('社群設定格式不正確'),{status:400});
  const url=entry.url.trim();
  if(url){let parsed;try{parsed=new URL(url);}catch{}if(!parsed||parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||![name+'.com','www.'+name+'.com'].includes(parsed.hostname))throw Object.assign(Error('請填寫正確的 '+name+' HTTPS 官方頁面網址'),{status:400});}
  if(entry.enabled&&!url)throw Object.assign(Error('顯示社群前請先填寫網址'),{status:400});
  result[name]={url,enabled:entry.enabled};
 }
 return result;
}
export function renderSocial(value){
 const social=validateSocial(value),entries=Object.entries(social).filter(([,v])=>v.enabled&&v.url);
 let section=document.getElementById('homepage-social');if(!section){section=document.createElement('section');section.id='homepage-social';section.className='homepage-media-section';document.getElementById('homepage-media').after(section);}
 section.replaceChildren();section.hidden=!entries.length;
 document.getElementById('footer-social')?.remove();if(!entries.length)return;
 const title=document.createElement('h2');title.textContent='追蹤吾鋼 / Follow WUGONG';section.append(title);
 const intro=document.createElement('p');intro.textContent='製作日常、新作品與活動消息 / Craft stories, new creations and events';intro.style.textAlign='center';section.append(intro);
 const links=document.createElement('nav');links.className='homepage-social-links';links.setAttribute('aria-label','社群連結 / Social media');
 for(const [name,v]of entries){const link=document.createElement('a');link.href=v.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=(name==='facebook'?'Facebook':'Instagram')+' ↗';links.append(link);}
 section.append(links);const footer=links.cloneNode(true);footer.id='footer-social';document.querySelector('footer')?.append(footer);
}
