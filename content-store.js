import {contentKinds,contentStates,validateContent} from './content-model.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const schema="CREATE TABLE IF NOT EXISTS content_entries (id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,title TEXT NOT NULL,summary TEXT NOT NULL,date TEXT NOT NULL,cover TEXT NOT NULL,source TEXT NOT NULL,blocks TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)";
const missing=e=>String(e.message).includes('no such table: content_entries');
const decoded=r=>({...r,blocks:JSON.parse(r.blocks)});
const columns='id,kind,title,summary,date,cover,source,blocks';
async function list(env,url,admin){
 const kind=url.searchParams.get('kind')||'',state=url.searchParams.get('status')||'',query=url.searchParams.get('q')||'',page=Number(url.searchParams.get('page')||1);
 if(kind&&!Object.hasOwn(contentKinds,kind)||state&&!Object.hasOwn(contentStates,state)||query.length>100||!Number.isSafeInteger(page)||page<1||page>10000)fail(400,'請確認篩選條件與頁碼');
 let where=" WHERE (?='' OR kind=?)";const args=[kind,kind];
 if(admin){where+=" AND (?='' OR status=?) AND (?='' OR instr(title,?)>0)";args.push(state,state,query,query);}else where+=" AND status='published'";
 const limit=admin?20:12;let rows=[];
 try{rows=(await env.DB.prepare('SELECT '+(admin?'id,kind,status,title,summary,date,cover,version,updated_at':'id,kind,title,summary,date,cover')+' FROM content_entries'+where+' ORDER BY date DESC,updated_at DESC,id DESC LIMIT ? OFFSET ?').bind(...args,limit+1,(page-1)*limit).all()).results;}catch(e){if(!missing(e))throw e;}
 return {entries:rows.slice(0,limit),hasMore:rows.length>limit,page};
}
async function entry(env,id,admin){if(typeof id!=='string'||!/^post-[a-f0-9-]{36}$/.test(id))fail(404,'找不到這篇內容');let row;try{row=await env.DB.prepare('SELECT '+(admin?'*':columns)+" FROM content_entries WHERE id=?"+(admin?'':" AND status='published'")).bind(id).first();}catch(e){if(!missing(e))throw e;}if(!row)fail(404,'找不到這篇內容');return decoded(row);}
export async function publicContent(env,url){return url.pathname==='/api/content'?list(env,url,false):{entry:await entry(env,url.searchParams.get('id'),false)};}
export async function manageContent(request,env,url,admin,body){
 if(request.method==='GET')return url.pathname==='/api/admin/content'?list(env,url,true):{entry:await entry(env,url.searchParams.get('id'),true)};
 if(request.method!=='POST'||url.pathname!=='/api/admin/content-entry')fail(405,'不支援的操作');
 const d=await body(request),value=validateContent(d);
 if(!Number.isSafeInteger(d.version)||d.version<0)fail(400,'內容版本不正確');
 if(d.id&&!/^post-[a-f0-9-]{36}$/.test(d.id))fail(400,'內容代碼不正確');
 if((!d.id&&d.version!==0)||(d.id&&d.version===0))fail(400,'內容版本不正確');
 await env.DB.prepare(schema).run();await env.DB.prepare('CREATE INDEX IF NOT EXISTS content_entries_listing ON content_entries(status,kind,date)').run();
 const old=d.id?await entry(env,d.id,true):null;if(old&&old.version!==d.version)fail(409,'這篇內容已更新，請重新載入後再編輯');
 for(const path of [value.cover,...value.blocks.filter(b=>b.type==='image').map(b=>b.src)])if(path.startsWith('/media/')&&!await env.DB.prepare('SELECT id FROM product_images WHERE id=?').bind(path.slice(7)).first())fail(400,'照片不存在，請重新上傳');
 const id=d.id||'post-'+crypto.randomUUID(),stamp=new Date().toISOString(),version=d.version+1;
 const args=[value.kind,value.status,value.title,value.summary,value.date,value.cover,value.source,JSON.stringify(value.blocks)];
 const write=old?env.DB.prepare('UPDATE content_entries SET kind=?,status=?,title=?,summary=?,date=?,cover=?,source=?,blocks=?,version=?,updated_at=? WHERE id=? AND version=?').bind(...args,version,stamp,id,d.version):env.DB.prepare('INSERT INTO content_entries(kind,status,title,summary,date,cover,source,blocks,id,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(...args,id,version,stamp,stamp);
 await env.DB.batch([write,env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),env.DB.prepare('INSERT INTO commerce_audit VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),admin.id,'content.'+(old?'update':'create'),id,JSON.stringify(old),JSON.stringify({...value,id,version}),'內容管理',stamp)]);
 return {entry:{...value,id,version,created_at:old?.created_at||stamp,updated_at:stamp}};
}
