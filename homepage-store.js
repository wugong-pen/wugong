import {defaults,validateHomepage} from './homepage-config.js';
export async function readHomepage(env){let row;try{row=await env.DB.prepare("SELECT value,version,updated_at FROM homepage_settings WHERE id='home'").first();}catch(e){if(!String(e.message).includes('no such table: homepage_settings'))throw e;}return {config:row?JSON.parse(row.value):defaults(),version:row?.version||0,updatedAt:row?.updated_at||null};}
export async function manageHomepage(request,env,m,body){
 if(request.method==='GET')return readHomepage(env);
 if(request.method!=='POST')throw Object.assign(new Error('不支援的操作'),{status:405});
 const data=await body(request),config=validateHomepage(data.config);
 if(!Number.isSafeInteger(data.version)||data.version<0)throw Object.assign(new Error('首頁版本不正確'),{status:400});
 // Additive initialization lets the first authorized save work on an existing deployment.
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS homepage_settings (id TEXT PRIMARY KEY CHECK(id='home'), value TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), updated_at TEXT NOT NULL)").run();
 const old=await readHomepage(env);if(old.version!==data.version)throw Object.assign(new Error('首頁已被其他管理員更新，請重新載入後再編輯'),{status:409});
 for(const path of [config.image,config.backgroundImage,...config.media.flatMap(b=>b.type==='slideshow'?b.photos.map(p=>p.src):[])])if(path.startsWith('/media/')&&!await env.DB.prepare('SELECT id FROM product_images WHERE id=?').bind(path.slice(7)).first())throw Object.assign(new Error('照片不存在，請重新上傳'),{status:400});
 const stamp=new Date().toISOString();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO homepage_settings(id,value,version,updated_at) SELECT 'home',?,1,? WHERE ?=0 ON CONFLICT(id) DO NOTHING").bind(JSON.stringify(config),stamp,data.version),
  ...(data.version===0?[]:[env.DB.prepare("UPDATE homepage_settings SET value=?,version=version+1,updated_at=? WHERE id='home' AND version=?").bind(JSON.stringify(config),stamp,data.version)]),
  env.DB.prepare('INSERT INTO catalog_checks(ok) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),
  env.DB.prepare('INSERT INTO commerce_audit VALUES (?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),m.id,'homepage.update','home',JSON.stringify(old.config),JSON.stringify(config),'首頁編輯',stamp)
 ]);
 return {config,version:data.version+1,updatedAt:stamp};
}
