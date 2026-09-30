import {validateNewsletter,newsletterContent} from './newsletter-model.js';
import {notificationSchema,notificationConfigured} from './order-notifications.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const token=()=>crypto.randomUUID().replaceAll('-','');
const timestamp=()=>new Date().toISOString();
export async function newsletterSchema(env){
 await env.DB.batch([
  env.DB.prepare("CREATE TABLE IF NOT EXISTS newsletter_preferences(member_id TEXT PRIMARY KEY,email TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),token TEXT NOT NULL UNIQUE,updated_at TEXT NOT NULL)"),
  env.DB.prepare("CREATE TABLE IF NOT EXISTS newsletter_campaigns(id TEXT PRIMARY KEY,content TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'draft',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sent_at TEXT)"),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS newsletter_approvals(token TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,version INTEGER NOT NULL,admin_id TEXT NOT NULL,recipients TEXT NOT NULL,expires_at INTEGER NOT NULL)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS newsletter_recipients(campaign_id TEXT NOT NULL,member_id TEXT NOT NULL,email TEXT NOT NULL,token TEXT NOT NULL,PRIMARY KEY(campaign_id,member_id),UNIQUE(campaign_id,email))')
 ]);
}
export function newsletterPreferenceStatement(env,m,enabled){
 return env.DB.prepare(`INSERT INTO newsletter_preferences(member_id,email,enabled,token,updated_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE id=?)
 ON CONFLICT(member_id) DO UPDATE SET email=excluded.email,enabled=excluded.enabled,updated_at=excluded.updated_at`).bind(m.id,m.email,enabled?1:0,token(),timestamp(),m.id);
}
export async function memberNewsletter(request,env,m,data){
 await newsletterSchema(env);
 if(request.method==='POST'){
  if(typeof data.enabled!=='boolean')fail(400,'請確認活動電子報訂閱選項');
  await newsletterPreferenceStatement(env,m,data.enabled).run();
 }else if(request.method!=='GET')fail(405,'不支援此操作');
 const p=await env.DB.prepare('SELECT email,enabled FROM newsletter_preferences WHERE member_id=?').bind(m.id).first();
 return {enabled:!!p?.enabled&&p.email.toLowerCase()===m.email.toLowerCase(),email:m.email,verified:!!m.email_verified};
}
const qualifyingPurchase=`EXISTS(SELECT 1 FROM member_orders mo JOIN orders o ON o.order_number=mo.order_number WHERE mo.member_id=m.id AND o.status IN ('shipped','completed') AND NOT EXISTS(SELECT 1 FROM admin_audit a WHERE a.order_number=o.order_number AND (a.previous_status='test_paid' OR a.next_status='test_paid')))`;
async function audience(env,kind){
 const rows=await env.DB.prepare(`SELECT m.id AS member_id,lower(m.email) AS email,p.token,p.updated_at FROM members m JOIN newsletter_preferences p ON p.member_id=m.id JOIN member_email_verified v ON v.member_id=m.id WHERE m.active=1 AND p.enabled=1 AND lower(p.email)=lower(m.email) AND ${qualifyingPurchase} AND (?='all' OR (?='domestic' AND m.country='TW') OR (?='overseas' AND m.country<>'TW')) ORDER BY m.id LIMIT 5001`).bind(kind,kind,kind).all();
 if(rows.results.length>5000)fail(400,'單次寄送上限為 5,000 位買家，請縮小收件對象');
 return rows.results;
}
async function campaign(env,id){
 const row=await env.DB.prepare('SELECT * FROM newsletter_campaigns WHERE id=?').bind(id||'').first();
 if(!row)fail(404,'找不到電子報');return {...JSON.parse(row.content),...row,content:undefined};
}
function payload(env,d,email,stop='',preview=false){
 return {from:env.MAIL_FROM,to:[email],reply_to:'wugong.pen@gmail.com',subject:(preview?'【內容預覽】':'')+d.subject,...newsletterContent(d,env.MAIL_ORIGIN,stop,preview)};
}
export async function manageNewsletters(request,env,url,admin,readBody){
 await newsletterSchema(env);await notificationSchema(env);
 const id=url.searchParams.get('id');
 if(request.method==='GET'){
  if(!id){const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>10000)fail(400,'頁碼不正確');const rows=await env.DB.prepare('SELECT id,content,state,version,updated_at FROM newsletter_campaigns ORDER BY updated_at DESC LIMIT 21 OFFSET ?').bind((page-1)*20).all();return {campaigns:rows.results.slice(0,20).map(r=>({id:r.id,subject:JSON.parse(r.content).subject,state:r.state,version:r.version,updated_at:r.updated_at})),hasMore:rows.results.length>20};}
  const d=await campaign(env,id);
  const counts=await env.DB.prepare("SELECT COALESCE(n.state,'waiting') AS state,count(*) AS total FROM newsletter_recipients r LEFT JOIN order_notifications n ON n.id='newsletter/'||r.campaign_id||'/'||r.member_id WHERE r.campaign_id=? GROUP BY COALESCE(n.state,'waiting')").bind(id).all();
  const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>10000)fail(400,'頁碼不正確');
  const records=await env.DB.prepare("SELECT r.email,COALESCE(n.state,'waiting') AS state,n.sent_at,n.last_error FROM newsletter_recipients r LEFT JOIN order_notifications n ON n.id='newsletter/'||r.campaign_id||'/'||r.member_id WHERE r.campaign_id=? ORDER BY r.email LIMIT 21 OFFSET ?").bind(id,(page-1)*20).all();
  const previews=await env.DB.prepare("SELECT state,sent_at,last_error FROM order_notifications WHERE id LIKE ? ORDER BY created_at DESC LIMIT 5").bind('newsletter-preview/'+id+'/%').all();
  return {campaign:d,counts:counts.results,records:records.results.slice(0,20),hasMore:records.results.length>20,previews:previews.results,configured:notificationConfigured(env)};
 }
 if(request.method!=='POST')fail(405,'不支援此操作');
 const input=await readBody(request),action=input.action;
 if(action==='save'){
  const d=validateNewsletter(input.campaign);
  if(d.image&&!await env.DB.prepare('SELECT id FROM product_images WHERE id=?').bind(d.image.slice(7)).first())fail(400,'照片不存在，請重新上傳');
  const old=await env.DB.prepare('SELECT state,version FROM newsletter_campaigns WHERE id=?').bind(d.id).first();
  if(old&&(old.state!=='draft'||old.version!==d.version)||!old&&d.version!==0)fail(409,'信件已更新或已開始寄送，請重新載入');
  const stamp=timestamp(),audit=crypto.randomUUID();
  const guard=old?"EXISTS(SELECT 1 FROM newsletter_campaigns WHERE id=? AND version=? AND state='draft')":"NOT EXISTS(SELECT 1 FROM newsletter_campaigns WHERE id=?)";
  const first=env.DB.prepare(`INSERT INTO admin_audit(id,member_id,action,order_number,created_at) SELECT ?,?,'newsletter.save',?,? WHERE ${guard}`).bind(audit,admin.id,d.id,stamp,d.id,...(old?[d.version]:[]));
  const second=old?env.DB.prepare("UPDATE newsletter_campaigns SET content=?,version=version+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM admin_audit WHERE id=?)").bind(JSON.stringify(d),stamp,d.id,audit):env.DB.prepare("INSERT INTO newsletter_campaigns(id,content,created_at,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM admin_audit WHERE id=?)").bind(d.id,JSON.stringify(d),stamp,stamp,audit);
  const results=await env.DB.batch([first,second]);if(!results[0].meta.changes)fail(409,'信件已更新，請重新載入');
  return {campaign:await campaign(env,d.id)};
 }
 const d=await campaign(env,input.id);
 if(action==='preview'){
  if(!notificationConfigured(env))fail(503,'寄信服務尚未設定完成');
  if(typeof input.email!=='string'||input.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(input.email)||!/^[a-zA-Z0-9-]{16,80}$/.test(input.key||''))fail(400,'請確認預覽收件信箱');
  const mailId='newsletter-preview/'+d.id+'/'+d.version+'/'+admin.id+'/'+input.key;
  const existing=await env.DB.prepare('SELECT payload FROM order_notifications WHERE id=?').bind(mailId).first();
  if(existing&&JSON.parse(existing.payload).to[0]!==input.email)fail(409,'此預覽已寄至另一信箱，請重新載入');
  await env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(mailId,JSON.stringify(payload(env,d,input.email,'',true)),timestamp()).run();return {queued:true};
 }
 if(action==='prepare'){
  if(d.state!=='draft'||d.version!==input.version)fail(409,'草稿已更新或開始寄送，請重新載入');
  if(!notificationConfigured(env))fail(503,'寄信服務尚未設定完成');
  const people=await audience(env,d.audience);if(!people.length)fail(400,'目前沒有符合條件的已訂閱買家；買家需完成信箱驗證並有出貨或完成訂單');
  const key=token();await env.DB.prepare('DELETE FROM newsletter_approvals WHERE expires_at<?').bind(Date.now()).run();
  await env.DB.prepare('INSERT INTO newsletter_approvals VALUES (?,?,?,?,?,?)').bind(key,d.id,d.version,admin.id,JSON.stringify(people),Date.now()+10*60000).run();
  return {token:key,count:people.length,subject:d.subject,audience:d.audience};
 }
 if(action==='send'){
  const approval=await env.DB.prepare('SELECT * FROM newsletter_approvals WHERE token=? AND campaign_id=? AND admin_id=?').bind(input.token||'',d.id,admin.id).first();
  if(!approval)fail(409,'請重新確認收件人數');
  if(d.state!=='draft')return {queued:true,alreadySent:true};
  if(approval.expires_at<=Date.now()||approval.version!==d.version||approval.recipients!==JSON.stringify(await audience(env,d.audience)))fail(409,'草稿、收件名單或確認時間已變更，請重新確認');
  if(!notificationConfigured(env))fail(503,'寄信服務尚未設定完成');
  const stamp=timestamp(),audit=crypto.randomUUID();
  const results=await env.DB.batch([
   env.DB.prepare("INSERT INTO admin_audit(id,member_id,action,order_number,created_at) SELECT ?,?,'newsletter.send',?,? WHERE EXISTS(SELECT 1 FROM newsletter_campaigns WHERE id=? AND version=? AND state='draft')").bind(audit,admin.id,d.id,stamp,d.id,d.version),
   env.DB.prepare("UPDATE newsletter_campaigns SET state='sending',version=version+1,sent_at=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM admin_audit WHERE id=?)").bind(stamp,stamp,d.id,audit),
   env.DB.prepare("INSERT INTO newsletter_recipients(campaign_id,member_id,email,token) SELECT ?,json_extract(value,'$.member_id'),json_extract(value,'$.email'),json_extract(value,'$.token') FROM json_each(?) WHERE EXISTS(SELECT 1 FROM admin_audit WHERE id=?)").bind(d.id,approval.recipients,audit)
  ]);if(!results[0].meta.changes)fail(409,'此信件已開始寄送，請查看寄送紀錄');return {queued:true};
 }
 fail(400,'不支援此操作');
}
export async function prepareNewsletterDeliveries(env){
 // Skip lazy schema setup on installations that have never used newsletters.
 if(!await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='newsletter_recipients'").first())return;
 await notificationSchema(env);
 const rows=await env.DB.prepare("SELECT r.*,c.content FROM newsletter_recipients r JOIN newsletter_campaigns c ON c.id=r.campaign_id WHERE c.state='sending' AND NOT EXISTS(SELECT 1 FROM order_notifications n WHERE n.id='newsletter/'||r.campaign_id||'/'||r.member_id) LIMIT 20").all();
 if(rows.results.length)await env.DB.batch(rows.results.map(r=>env.DB.prepare('INSERT INTO order_notifications(id,payload,created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind('newsletter/'+r.campaign_id+'/'+r.member_id,JSON.stringify(payload(env,JSON.parse(r.content),r.email,env.MAIL_ORIGIN+'/newsletter/unsubscribe?token='+r.token)),timestamp())));
 await env.DB.prepare("UPDATE newsletter_campaigns SET state='finished' WHERE state='sending' AND NOT EXISTS(SELECT 1 FROM newsletter_recipients r LEFT JOIN order_notifications n ON n.id='newsletter/'||r.campaign_id||'/'||r.member_id WHERE r.campaign_id=newsletter_campaigns.id AND (n.id IS NULL OR n.state='queued'))").run();
}
export async function newsletterUnsubscribe(request,env){
 const url=new URL(request.url),key=url.searchParams.get('token')||'';
 const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'X-Robots-Tag':'noindex, nofollow'};
 if(!/^[a-f0-9]{32}$/.test(key))return new Response('連結無效 / Invalid link',{status:400,headers});
 if(!['GET','POST'].includes(request.method))return new Response('Method not allowed',{status:405,headers});
 await newsletterSchema(env);const p=await env.DB.prepare('SELECT enabled FROM newsletter_preferences WHERE token=?').bind(key).first();
 if(!p)return new Response('連結無效 / Invalid link',{status:404,headers});
 if(request.method==='POST'){
  if(request.headers.get('Origin')!==url.origin)return new Response('請由確認頁送出 / Please use the confirmation page',{status:403,headers});
  await env.DB.prepare('UPDATE newsletter_preferences SET enabled=0,updated_at=? WHERE token=?').bind(timestamp(),key).run();
 }
 const stopped=!p.enabled||request.method==='POST';
 return new Response(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WUGONG 電子報訂閱</title><body style="max-width:640px;margin:64px auto;padding:24px;font:18px/1.8 sans-serif"><h1>WUGONG 吾鋼</h1><h2>${stopped?'已取消活動電子報訂閱 / Unsubscribed':'取消活動電子報訂閱 / Unsubscribe'}</h2><p>訂單、出貨及必要售後通知不受影響。<br>Essential order, shipping and service notices are unaffected.</p>${stopped?'':`<form method="post"><button type="submit" style="padding:12px">確認退訂 / Confirm unsubscribe</button></form>`}</body></html>`,{headers});
}
