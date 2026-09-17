export const contentKinds={blog:'網誌圖文',awards:'獲獎紀錄',events:'活動花絮',media:'媒體採訪'};
export const contentStates={draft:'草稿',published:'已發布',archived:'已封存'};
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export const imagePath=v=>typeof v==='string'&&(/^\/media\/[a-f0-9]{64}$/.test(v)||/^\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(jpg|jpeg|png|webp)$/i.test(v));
export function sourceURL(value){if(!value)return '';try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error();return u.href;}catch{fail('來源連結請使用完整的 https 網址');}}
export function youtubeId(value){
 if(typeof value!=='string'||value.length>4000)fail('請貼上 YouTube 影片網址或嵌入程式碼');
 value=value.trim();
 if(value.startsWith('<')){const src=value.match(/<iframe\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);if(!src)fail('請貼上 YouTube 提供的 iframe 嵌入程式碼');value=src[1].replace(/&amp;/g,'&');}
 if(/^[\w-]{11}$/.test(value))return value;
 let u;try{u=new URL(value);}catch{fail('請貼上完整的 YouTube 影片網址');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!['youtube.com','www.youtube.com','m.youtube.com','youtu.be','www.youtube-nocookie.com'].includes(u.hostname))fail('請使用 YouTube 的影片網址');
 const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.pathname==='/watch'?u.searchParams.get('v'):/^\/(?:embed|shorts)\/([\w-]{11})\/?$/.exec(u.pathname)?.[1];
 if(!/^[\w-]{11}$/.test(id||''))fail('找不到有效的 YouTube 影片代碼');return id;
}
export function validateContent(d){
 const text=(v,max,label)=>{if(typeof v!=='string'||v.length>max)fail(label+'格式或長度不正確');return v.trim();};
 if(!d||typeof d!=='object'||Array.isArray(d))fail('內容格式不正確');
 if(!Object.hasOwn(contentKinds,d.kind)||!Object.hasOwn(contentStates,d.status))fail('請選擇內容類型及狀態');
 const title=text(d.title,160,'標題'),summary=text(d.summary,400,'摘要'),date=text(d.date,10,'日期');
 if(!title)fail('請填寫標題');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail('請選擇有效日期');
 const cover=text(d.cover,100,'封面照片');if(cover&&!imagePath(cover))fail('請使用本站上傳的封面照片');
 if(!Array.isArray(d.blocks)||d.blocks.length>24)fail('每篇內容最多 24 個圖文區塊');
 const blocks=d.blocks.map(b=>{if(b?.type==='text')return{type:'text',text:text(b.text,5000,'內文')};if(b?.type==='image'&&imagePath(b.src))return{type:'image',src:b.src,caption:text(b.caption,300,'圖片說明')};if(b?.type==='youtube')return{type:'youtube',id:youtubeId(b.id),caption:text(b.caption,300,'影片說明')};fail('圖文區塊格式不正確');});
 if(blocks.filter(b=>b.type==='image').length>12)fail('每篇內容最多 12 張內文照片');
 if(title.length+summary.length+blocks.reduce((sum,b)=>sum+(b.text||b.caption||'').length,0)>7500)fail('每篇內容的文字總長度請在 7500 字以內');
 if(d.status==='published'&&!blocks.some(b=>b.type!=='text'||b.text))fail('發布前請加入內文、照片或影片');
 return {kind:d.kind,status:d.status,title,summary,date,cover,source:sourceURL(text(d.source,1000,'來源連結')),blocks};
}
