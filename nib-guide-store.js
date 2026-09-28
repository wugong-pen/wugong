import {guideFields} from './nib-guide-model.js';
import {imagePath} from './content-model.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const schema='CREATE TABLE IF NOT EXISTS nib_guides(id TEXT PRIMARY KEY,status TEXT NOT NULL,position INTEGER NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL)';
const decode=r=>({id:r.id,status:r.status,position:r.position,...JSON.parse(r.data),version:r.version});
export async function listGuides(env,url,admin=false){
 const page=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>10000)fail(400,'頁碼不正確');
 let rows=[];try{rows=(await env.DB.prepare('SELECT * FROM nib_guides'+(admin?'':" WHERE status='published'")+' ORDER BY position,id LIMIT 21 OFFSET ?').bind((page-1)*20).all()).results;}catch(e){if(!String(e.message).includes('no such table: nib_guides'))throw e;}
 return {entries:rows.slice(0,20).map(decode).map(e=>{if(!admin)delete e.version;return e;}),page,hasMore:rows.length>20};
}
export function validateGuide(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||!['draft','published','archived'].includes(d.status)||!Number.isSafeInteger(d.position)||d.position<0||d.position>9999||!Number.isSafeInteger(d.version)||d.version<0||typeof d.id!=='string'||(d.id&&!/^guide-[a-f0-9-]{36}$/.test(d.id))||(!d.id&&d.version!==0)||(d.id&&d.version===0))fail(400,'請確認指南狀態、排序與版本');
 const text=(v,max)=>{if(typeof v!=='string'||v.length>max)fail(400,'指南文字格式或長度不正確');return v.trim();};const out={};
 for(const lang of ['zh','en']){if(!d[lang]||typeof d[lang]!=='object'||Array.isArray(d[lang]))fail(400,'請確認中英文欄位');out[lang]=Object.fromEntries(guideFields.map(([k])=>[k,text(d[lang][k],k==='name'?100:800)]));}
 if(!out.zh.name)fail(400,'請填寫中文名稱');
 if(d.status==='published'&&!guideFields.slice(1).some(([k])=>out.zh[k]))fail(400,'發布前請至少填寫一項說明');
 if(!Array.isArray(d.photos)||d.photos.length>6)fail(400,'試寫照片最多六張');out.photos=d.photos.map(p=>{if(!p||!imagePath(p.src))fail(400,'請使用本站上傳的試寫照片');return {src:p.src,zh:text(p.zh,200),en:text(p.en,200)};});
 if(new TextEncoder().encode(JSON.stringify(out)).length>28000)fail(400,'指南內容過長，請分成多筆指南');return out;
}
export async function manageGuides(request,env,url,admin,body){
 if(request.method==='GET')return listGuides(env,url,true);if(request.method!=='POST')fail(405,'不支援的操作');
 const d=await body(request),value=validateGuide(d);await env.DB.prepare(schema).run();const old=d.id?await env.DB.prepare('SELECT * FROM nib_guides WHERE id=?').bind(d.id).first():null;
 if(d.id&&(!old||old.version!==d.version))fail(409,'指南已更新，請重新載入後再編輯');
 for(const p of value.photos)if(p.src.startsWith('/media/')&&!await env.DB.prepare('SELECT id FROM product_images WHERE id=?').bind(p.src.slice(7)).first())fail(400,'照片不存在，請重新上傳');
 const id=d.id||'guide-'+crypto.randomUUID(),stamp=new Date().toISOString(),version=d.version+1;
 const write=old?env.DB.prepare('UPDATE nib_guides SET status=?,position=?,data=?,version=?,updated_at=? WHERE id=? AND version=?').bind(d.status,d.position,JSON.stringify(value),version,stamp,id,d.version):env.DB.prepare('INSERT INTO nib_guides VALUES (?,?,?,?,?,?)').bind(id,d.status,d.position,JSON.stringify(value),version,stamp);
 await env.DB.batch([write,env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),env.DB.prepare('INSERT INTO commerce_audit VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.id,'guide.'+(old?'update':'create'),id,JSON.stringify(old?decode(old):null),JSON.stringify({...value,status:d.status,position:d.position,version}),'筆尖與規格指南',stamp)]);
 return {entry:{...value,id,status:d.status,position:d.position,version}};
}
