export const newsletterAudiences={all:'全部已訂閱買家',domestic:'國內已訂閱買家',overseas:'海外已訂閱買家'};
export const blankNewsletter=()=>({id:crypto.randomUUID(),version:0,state:'draft',audience:'all',subject:'',zh:'',en:'',image:'',imageAlt:'',link:'',linkLabel:''});
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
export function validateNewsletter(data){
 if(!data||typeof data!=='object'||Array.isArray(data))invalid('請填寫電子報內容');
 const d={};
 for(const [key,max] of Object.entries({id:36,subject:160,zh:6000,en:6000,image:100,imageAlt:160,link:1000,linkLabel:120,audience:20})){
  if(typeof data[key]!=='string'||data[key].length>max)invalid('請確認信件欄位與字數');d[key]=data[key].trim();
 }
 if(!/^[a-f0-9-]{36}$/.test(d.id)||!Number.isInteger(data.version)||data.version<0||!Object.hasOwn(newsletterAudiences,d.audience))invalid('信件編號、版本或收件對象不正確');
 if(!d.subject||(!d.zh&&!d.en)||/[\r\n\x00-\x1f\x7f]/.test(d.subject))invalid('請填寫單行主旨及至少一種語言的內容');
 if(d.image&&!/^\/media\/[a-f0-9]{64}$/.test(d.image))invalid('請使用後台上傳的圖片');
 if(d.image&&!d.imageAlt)invalid('請填寫圖片說明');
 if(d.link){let u;try{u=new URL(d.link);}catch{invalid('請填寫完整的 HTTPS 活動或商品網址');}if(u.protocol!=='https:'||u.username||u.password||/[\s<>"\x00-\x1f]/.test(d.link))invalid('請填寫安全的 HTTPS 網址');if(!d.linkLabel)invalid('請填寫連結按鈕文字');}
 d.version=data.version;return d;
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function newsletterContent(d,origin,unsubscribe='',preview=false){
 const intro=preview?'此信為內容預覽，尚未寄送給買家。 / Content preview; not sent to buyers.':'';
 const stop=unsubscribe?'取消活動電子報訂閱 / Unsubscribe: '+unsubscribe:'正式寄給買家的信件會附上退訂連結。 / Buyer emails include an unsubscribe link.';
 const footer='WUGONG 吾鋼 · wugong.pen@gmail.com\n取消活動電子報不影響訂單、出貨及必要售後通知。\nUnsubscribing does not affect essential order, shipping or service notices.';
 return {
  text:[intro,d.zh,d.en,d.image?d.imageAlt+'\n'+origin+d.image:'',d.link?d.linkLabel+'\n'+d.link:'',footer,stop].filter(Boolean).join('\n\n'),
  html:`<!doctype html><html><body style="margin:0;background:#f5f1e9;color:#29251f;font:16px/1.8 Arial,sans-serif"><div style="max-width:620px;margin:auto;padding:32px 24px;background:#fff"><p style="letter-spacing:3px;color:#806333">WUGONG 吾鋼</p>${intro?`<p>${esc(intro)}</p>`:''}<h1 style="font-size:25px">${esc(d.subject)}</h1>${d.image?`<img src="${esc(origin+d.image)}" alt="${esc(d.imageAlt)}" style="max-width:100%;height:auto">`:''}${[d.zh,d.en].filter(Boolean).map(s=>`<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(s).replace(/\n/g,'<br>')}</p>`).join('')}${d.link?`<p><a href="${esc(d.link)}" style="display:inline-block;padding:10px 20px;background:#29251f;color:#fff">${esc(d.linkLabel)}</a></p>`:''}<hr><p style="font-size:13px">${esc(footer).replace(/\n/g,'<br>')}</p><p style="font-size:13px">${unsubscribe?`<a href="${esc(unsubscribe)}">取消活動電子報訂閱 / Unsubscribe</a>`:esc(stop)}</p></div></body></html>`
 };
}
