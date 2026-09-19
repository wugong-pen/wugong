import {firstGiftQuote,firstGiftStatements} from './first-purchase.js';
import {readHomepage,manageHomepage} from './homepage-store.js';
import {publicContent,manageContent} from './content-store.js';
import {discountQuote,couponStatements} from './modules.js';
import {expireReservations,checkStock,reserveStatements} from './inventory.js';
import {methods,start,confirm,reconcilePayments} from './payments.js';
import {quote,paymentForm,notify,sandbox} from './ecpay.js';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { COUNTRY_CODES } from './countries.js';
import {catalogQuote,catalogGuards,publicCommerce,manageCommerce} from './commerce.js';
const COOKIE = '__Host-wugong_session', TTL = 604800;
const ADMIN_COOKIE = '__Host-wugong_admin', ADMIN_TTL = 3600;
const adminCookie = (token,age=ADMIN_TTL) => `${ADMIN_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const now = () => Math.floor(Date.now()/1000);
const hex = bytes => Array.from(new Uint8Array(bytes), x=>x.toString(16).padStart(2,'0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
const fail = (status,message) => {throw new HttpError(status,message);};
const json = (data,status=200,headers={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const publicMember = m => ({id:m.id,email:m.email,name:m.name,birthday:m.birthday,country:m.country,phone:m.phone,address:m.address,createdAt:m.created_at,emailVerified:!!m.email_verified});
const cookie = (token,age=TTL) => `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
function text(value,max,label,required=true) {
  if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim())) fail(400,`請確認${label}`);
  return value.trim();
}
function email(value) {
  const result=text(value,254,'電子郵件').toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400,'請輸入有效的電子郵件');
  return result;
}
function password(value) {
  if(typeof value!=='string'||[...value].length<15||value.length>128) fail(400,'密碼請使用 15 至 128 個字元，可使用長句');
  return value;
}
function profile(data) {
  const name=text(data.name,100,'姓名'), birthday=text(data.birthday,10,'生日');
  const date=new Date(`${birthday}T00:00:00Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(birthday)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==birthday||birthday<'1900-01-01'||birthday>new Date().toISOString().slice(0,10)) fail(400,'請輸入有效的生日，不能是未來日期');
  if(!COUNTRY_CODES.includes(data.country)) fail(400,'請選擇國家／地區');
  return {name,birthday,country:data.country,phone:text(data.phone??'',40,'電話',false),address:text(data.address??'',500,'地址',false)};
}
async function hashPassword(value,salt=random()) {
  // OWASP scrypt profile using 16 MiB, supported by native Workers crypto.
  const hash=await new Promise((resolve,reject)=>scrypt(value,salt,32,{N:16384,r:8,p:5,maxmem:33554432},(error,key)=>error?reject(error):resolve(key)));
  return `scrypt$16384$8$5$${salt}$${hex(hash)}`;
}
async function verifyPassword(value,stored) {
  const expected=stored||`scrypt$16384$8$5$${'0'.repeat(64)}$${'0'.repeat(64)}`;
  if(!/^scrypt\$16384\$8\$5\$[a-f0-9]{64}\$[a-f0-9]{64}$/.test(expected))return false;
  const actual=await hashPassword(value,expected.split('$')[4]);
  const a=new TextEncoder().encode(actual),b=new TextEncoder().encode(expected);
  return a.length===b.length&&timingSafeEqual(a,b);
}
async function body(request) {
  if(!(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json')) fail(415,'請使用 JSON 格式');
  if(Number(request.headers.get('Content-Length'))>32768) fail(413,'資料過長');
  const reader=request.body?.getReader(); if(!reader) fail(400,'缺少資料');
  const chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();fail(413,'資料過長');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}catch{fail(400,'資料格式不正確');}
}
async function rate(env,key,limit) {
  const time=now();
  const row=await env.DB.prepare(`INSERT INTO member_rate_limits(key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`).bind(await digest(key),time+900,time,time).first();
  if(row.attempts>limit) fail(429,'嘗試次數過多，請於 15 分鐘後再試');
}
async function session(request,env,required=true) {
  const token=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  const member=token&&/^[a-f0-9]{64}$/.test(token)?await env.DB.prepare('SELECT m.*,s.token_hash,EXISTS(SELECT 1 FROM member_email_verified v WHERE v.member_id=m.id) AS email_verified FROM member_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>? AND m.active=1').bind(await digest(token),now()).first():null;
  if(!member&&required) fail(401,'請先登入會員');return member;
}
async function issueSession(env,member,request,extra={}) {
  const token=random(),previous=await session(request,env,false);
  const statements=[env.DB.prepare('INSERT INTO member_sessions(token_hash,member_id,expires_at) VALUES (?,?,?)').bind(await digest(token),member.id,now()+TTL),env.DB.prepare('DELETE FROM member_sessions WHERE expires_at<=?').bind(now()),env.DB.prepare('DELETE FROM member_rate_limits WHERE expires_at<=?').bind(now())];
  if(previous) statements.push(env.DB.prepare('DELETE FROM member_sessions WHERE token_hash=?').bind(previous.token_hash));
  await env.DB.batch(statements);
  return json({success:true,member:publicMember(member),emailAvailable:mailAvailable(env,new URL(request.url)),...extra},200,{'Set-Cookie':cookie(token)});
}
async function adminSession(request,env,required=true) {
  const token=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${ADMIN_COOKIE}=`))?.slice(ADMIN_COOKIE.length+1);
  const m=token&&/^[a-f0-9]{64}$/.test(token)?await env.DB.prepare('SELECT m.id,m.email,m.name,s.token_hash FROM admin_sessions s JOIN members m ON m.id=s.member_id JOIN admin_members a ON a.member_id=m.id WHERE s.token_hash=? AND s.expires_at>? AND m.active=1 AND a.active=1 AND s.password_snapshot=m.password_hash').bind(await digest(token),now()).first():null;
  if(!m&&required)fail(403,'請使用有權限的管理員帳號登入');
  return m;
}
async function adminApi(request,env,url) {
  const path=url.pathname,method=request.method;
  if(path==='/api/admin/login'&&method==='POST') {
    await rate(env,`admin-login-ip:${request.headers.get('CF-Connecting-IP')||'local'}`,20);
    const data=await body(request),address=email(data.email);
    await rate(env,`admin-login-email:${address}`,8);
    if(typeof data.password!=='string'||data.password.length>128)fail(400,'請確認密碼');
    const m=await env.DB.prepare('SELECT m.* FROM members m JOIN admin_members a ON a.member_id=m.id WHERE m.email=? AND a.active=1').bind(address).first();
    if(!await verifyPassword(data.password,m?.password_hash)||!m?.active)fail(401,'帳號、密碼或管理員權限不正確');
    const token=random(),old=await adminSession(request,env,false);
    const statements=[env.DB.prepare('INSERT INTO admin_sessions(token_hash,member_id,password_snapshot,expires_at) VALUES (?,?,?,?)').bind(await digest(token),m.id,m.password_hash,now()+ADMIN_TTL),env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now()),env.DB.prepare('INSERT INTO admin_audit(id,member_id,action,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),m.id,'login',new Date().toISOString())];
    if(old)statements.push(env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(old.token_hash));
    await env.DB.batch(statements);
    return json({success:true,admin:{name:m.name,email:m.email}},200,{'Set-Cookie':adminCookie(token)});
  }
  if(path==='/api/admin/logout'&&method==='POST') {
    const m=await adminSession(request,env,false);
    if(m)await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(m.token_hash).run();
    return json({success:true},200,{'Set-Cookie':adminCookie('',0)});
  }
  const m=await adminSession(request,env);
  if(['/api/admin/content','/api/admin/content-entry'].includes(path)){if(method!=='GET')await rate(env,`admin-content:${m.id}`,120);return json({success:true,...await manageContent(request,env,url,m,body)});}
  if(path==='/api/admin/homepage'){if(method!=='GET')await rate(env,`admin-homepage:${m.id}`,60);return json({success:true,...await manageHomepage(request,env,m,body)});}
  if(path.startsWith('/api/admin/')&&!['/api/admin/session','/api/admin/orders','/api/admin/order/status'].includes(path)&&!path.startsWith('/api/admin/orders/')) {
    if(method!=='GET')await rate(env,`admin-commerce:${m.id}`,120);
    const result=await manageCommerce(request,env,url,m,body);if(result!==null)return json({success:true,...result});
  }
  if(path==='/api/admin/session'&&method==='GET')return json({success:true,admin:{name:m.name,email:m.email}});
  const base='SELECT o.order_number,o.customer_name,o.phone,o.email,o.address,o.shipping,o.payment,o.note,o.items,o.total,o.status,o.created_at,mo.shipping_country FROM orders o LEFT JOIN member_orders mo ON mo.order_number=o.order_number';
  if((path==='/api/admin/orders'||path==='/api/orders')&&method==='GET') {
    const page=Number(url.searchParams.get('page')||1);
    if(!Number.isSafeInteger(page)||page<1||page>100000)fail(400,'頁碼不正確');
    const search=text(url.searchParams.get('q')||'',100,'搜尋',false),state=text(url.searchParams.get('status')||'',30,'狀態',false);
    const rows=await env.DB.prepare(base+" WHERE (?='' OR instr(o.order_number,?)>0 OR instr(o.customer_name,?)>0 OR instr(o.email,?)>0) AND (?='' OR o.status=?) ORDER BY o.created_at DESC,o.order_number DESC LIMIT 21 OFFSET ?").bind(search,search,search,search,state,state,(page-1)*20).all();
    return json({success:true,orders:rows.results.slice(0,20),hasMore:rows.results.length>20});
  }
  if(path.startsWith('/api/admin/orders/')&&method==='GET') {
    let number;try{number=decodeURIComponent(path.slice('/api/admin/orders/'.length));}catch{fail(400,'訂單編號不正確');}
    const order=await env.DB.prepare(base+' WHERE o.order_number=?').bind(text(number,60,'訂單編號')).first();
    if(!order)fail(404,'找不到此訂單');return json({success:true,order});
  }
  if((path==='/api/admin/order/status'||path==='/api/order/status')&&method==='POST') {
    await rate(env,`admin-update:${m.id}`,100);
    const data=await body(request),number=text(data.orderNumber,60,'訂單編號');
    // Payment/stock transitions belong exclusively to verified payment workflows.
    if(!Object.keys(data).every(k=>['orderNumber','status','expectedStatus'].includes(k)))fail(400,'不支援的訂單欄位');
    const transitions={paid:'shipped',shipped:'completed'};
    if(!Object.hasOwn(transitions,data.expectedStatus)||transitions[data.expectedStatus]!==data.status)fail(409,'只能將已付款訂單標記出貨，或將已出貨訂單標記完成');
    const id=crypto.randomUUID();
    const results=await env.DB.batch([
      env.DB.prepare('INSERT INTO admin_audit(id,member_id,action,order_number,previous_status,next_status,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE order_number=? AND status=?)').bind(id,m.id,'order.status',number,data.expectedStatus,data.status,new Date().toISOString(),number,data.expectedStatus),
      env.DB.prepare('UPDATE orders SET status=? WHERE order_number=? AND status=? AND EXISTS(SELECT 1 FROM admin_audit WHERE id=?)').bind(data.status,number,data.expectedStatus,id)
    ]);
    if(!results[1].meta.changes)fail(409,'訂單狀態已變更或訂單不存在，請重新整理');
    return json({success:true});
  }
  fail(404,'找不到此功能');
}
function mailAvailable(env,url) {
  return !!(env.RESEND_API_KEY&&env.MAIL_FROM&&env.MAIL_ORIGIN===url.origin&&url.protocol==='https:');
}
async function sendMemberEmail(env,m,purpose,url) {
  if(!mailAvailable(env,url))fail(503,'寄信服務準備中，請稍後再試');
  const token=random(),tokenHash=await digest(token),minutes=purpose==='reset'?30:1440;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM member_email_tokens WHERE expires_at<=?').bind(now()),
    env.DB.prepare('INSERT INTO member_email_tokens(token_hash,member_id,purpose,password_snapshot,expires_at) VALUES (?,?,?,?,?)').bind(tokenHash,m.id,purpose,m.password_hash,now()+minutes*60)
  ]);
  const link=`${env.MAIL_ORIGIN}/member#${new URLSearchParams({action:purpose,token})}`;
  const title=purpose==='reset'?'重設 WUGONG 會員密碼':'驗證 WUGONG 會員電子郵件';
  const content=`${title}\n\n請開啟以下連結完成操作：\n${link}\n\n連結有效時間：${purpose==='reset'?'30 分鐘':'24 小時'}，只能使用一次。\n若您未申請此操作，請忽略此信。請勿將連結轉寄給他人。`;
  try {
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':tokenHash},body:JSON.stringify({from:env.MAIL_FROM,to:[m.email],subject:(env.APP_ENV==='staging'?'【測試站】':'')+title,text:content}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(`Mail provider status ${response.status}`);
    const result=await response.json();if(!result.id)throw new Error('Missing mail receipt');
  }catch{
    await env.DB.prepare('DELETE FROM member_email_tokens WHERE token_hash=?').bind(tokenHash).run();
    fail(503,'暫時無法寄信，請稍後再試');
  }
}
async function consumeEmailToken(request,env,purpose) {
  await rate(env,`email-token:${request.headers.get('CF-Connecting-IP')||'local'}`,30);
  const data=await body(request);
  if(typeof data.token!=='string'||!/^[a-f0-9]{64}$/.test(data.token))fail(400,'連結無效或已過期，請重新申請');
  const tokenHash=await digest(data.token);
  const row=await env.DB.prepare('SELECT t.*,m.password_hash FROM member_email_tokens t JOIN members m ON m.id=t.member_id WHERE t.token_hash=? AND t.purpose=? AND t.expires_at>? AND t.consumed_by IS NULL AND m.active=1 AND m.password_hash=t.password_snapshot').bind(tokenHash,purpose,now()).first();
  if(!row)fail(400,'連結無效或已過期，請重新申請');
  const newHash=purpose==='reset'?await hashPassword(password(data.password)):null;
  const claim=random();
  const owns='EXISTS(SELECT 1 FROM member_email_tokens WHERE token_hash=? AND consumed_by=?)';
  const statements=[env.DB.prepare('UPDATE member_email_tokens SET consumed_by=? WHERE token_hash=? AND consumed_by IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM members WHERE id=member_email_tokens.member_id AND active=1 AND password_hash=member_email_tokens.password_snapshot)').bind(claim,tokenHash,now())];
  if(purpose==='reset')statements.push(
    env.DB.prepare(`UPDATE members SET password_hash=?,updated_at=? WHERE id=? AND ${owns}`).bind(newHash,new Date().toISOString(),row.member_id,tokenHash,claim),
    env.DB.prepare(`DELETE FROM member_sessions WHERE member_id=? AND ${owns}`).bind(row.member_id,tokenHash,claim)
  );
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO member_email_verified(member_id,verified_at) SELECT ?,? WHERE ${owns}`).bind(row.member_id,now(),tokenHash,claim));
  statements.push(env.DB.prepare(`DELETE FROM member_email_tokens WHERE member_id=? AND token_hash<>? AND ${owns}`).bind(row.member_id,tokenHash,tokenHash,claim));
  const results=await env.DB.batch(statements);
  if(!results[0].meta.changes)fail(400,'連結無效或已過期，請重新申請');
  return json({success:true},200,purpose==='reset'?{'Set-Cookie':cookie('',0)}:{});
}
async function api(request,env,url,ctx) {
  const path=url.pathname,method=request.method;
  if(['/api/content','/api/content-entry'].includes(path)&&method==='GET')return json({success:true,...await publicContent(env,url)});
  if(path==='/api/homepage'&&method==='GET')return json({success:true,...await readHomepage(env)});
  if(['/api/catalog','/api/categories'].includes(path)&&method==='GET')return json({success:true,...await publicCommerce(request,env,url)});
  if(path==='/api/payments/ecpay/notify')return notify(request,env);
  if(!['GET','HEAD'].includes(method)&&(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')) fail(403,'請從本站頁面操作');
  if(path.startsWith('/api/admin/')||path==='/api/orders'||path==='/api/order/status')return adminApi(request,env,url);
  if(path==='/api/member'&&method==='GET') {const m=await session(request,env,false);return json({success:true,member:m?publicMember(m):null,emailAvailable:mailAvailable(env,url)});}
  if(path==='/api/member/verify-email'&&method==='POST')return consumeEmailToken(request,env,'verify');
  if(path==='/api/member/reset-password'&&method==='POST')return consumeEmailToken(request,env,'reset');
  if(path==='/api/member/resend-verification'&&method==='POST') {
    const m=await session(request,env);if(m.email_verified)return json({success:true,alreadyVerified:true});
    await rate(env,`verify-mail:${m.id}`,3);await sendMemberEmail(env,m,'verify',url);return json({success:true});
  }
  if(path==='/api/member/forgot-password'&&method==='POST') {
    if(!mailAvailable(env,url))fail(503,'寄信服務準備中，請稍後再試');
    await rate(env,`forgot-ip:${request.headers.get('CF-Connecting-IP')||'local'}`,10);
    const address=email((await body(request)).email);await rate(env,`forgot-email:${address}`,3);
    const m=await env.DB.prepare('SELECT * FROM members WHERE email=? AND active=1').bind(address).first();
    if(m){const delivery=sendMemberEmail(env,m,'reset',url).catch(()=>console.error('Password reset email delivery failed'));if(ctx?.waitUntil)ctx.waitUntil(delivery);else await delivery;}
    return json({success:true,message:'若此電子郵件已註冊，您會收到重設密碼連結；請查看收件匣與垃圾郵件。若未收到，請稍後再試。'});
  }
  if(path==='/api/member/register'&&method==='POST') {
    await rate(env,`register:${request.headers.get('CF-Connecting-IP')||'local'}`,8);
    const data=await body(request),p=profile(data),address=email(data.email),secret=password(data.password),stamp=new Date().toISOString();
    const m={id:crypto.randomUUID(),email:address,...p,created_at:stamp};
    m.password_hash=await hashPassword(secret);
    const result=await env.DB.prepare('INSERT OR IGNORE INTO members(id,email,password_hash,name,birthday,country,phone,address,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(m.id,address,m.password_hash,p.name,p.birthday,p.country,p.phone,p.address,stamp,stamp).run();
    if(!result.meta.changes) fail(409,'無法使用這個電子郵件註冊；若已有帳號，請登入');
    let verificationSent=false;
    if(mailAvailable(env,url)){try{await sendMemberEmail(env,m,'verify',url);verificationSent=true;}catch{console.error('Registration verification email delivery failed');}}
    return issueSession(env,m,request,{verificationSent});
  }
  if(path==='/api/member/login'&&method==='POST') {
    await rate(env,`login-ip:${request.headers.get('CF-Connecting-IP')||'local'}`,30);
    const data=await body(request),address=email(data.email);
    if(typeof data.password!=='string'||data.password.length>128) fail(400,'請確認密碼');
    await rate(env,`login-email:${address}`,10);
    const m=await env.DB.prepare('SELECT m.*,EXISTS(SELECT 1 FROM member_email_verified v WHERE v.member_id=m.id) AS email_verified FROM members m WHERE email=?').bind(address).first();
    const valid=await verifyPassword(data.password,m?.password_hash);
    if(!valid||!m?.active) fail(401,'電子郵件或密碼不正確');return issueSession(env,m,request);
  }
  if(path==='/api/member/logout'&&method==='POST') {
    const m=await session(request,env,false);if(m)await env.DB.prepare('DELETE FROM member_sessions WHERE token_hash=?').bind(m.token_hash).run();
    return json({success:true},200,{'Set-Cookie':cookie('',0)});
  }
  if(path==='/api/member'&&method==='PATCH') {
    const m=await session(request,env),p=profile(await body(request));
    await env.DB.prepare('UPDATE members SET name=?,birthday=?,country=?,phone=?,address=?,updated_at=? WHERE id=?').bind(p.name,p.birthday,p.country,p.phone,p.address,new Date().toISOString(),m.id).run();
    return json({success:true,member:publicMember({...m,...p})});
  }
  if(path==='/api/member/password'&&method==='POST') {
    const m=await session(request,env);await rate(env,`password:${m.id}`,8);
    const data=await body(request),secret=password(data.password);
    if(typeof data.currentPassword!=='string'||data.currentPassword.length>128||!await verifyPassword(data.currentPassword,m.password_hash))fail(400,'目前密碼不正確');
    await env.DB.batch([env.DB.prepare('UPDATE members SET password_hash=?,updated_at=? WHERE id=?').bind(await hashPassword(secret),new Date().toISOString(),m.id),env.DB.prepare('DELETE FROM member_sessions WHERE member_id=?').bind(m.id),env.DB.prepare('DELETE FROM member_email_tokens WHERE member_id=?').bind(m.id)]);
    return json({success:true},200,{'Set-Cookie':cookie('',0)});
  }
  if((path==='/api/member/orders'||path.startsWith('/api/member/orders/'))&&method==='GET') {
    const m=await session(request,env);await expireReservations(env);
    const base='SELECT o.order_number,o.customer_name,o.phone,o.email,o.address,o.shipping,o.payment,o.note,o.items,o.total,o.status,o.created_at,mo.shipping_country,(SELECT state FROM checkout_reservations WHERE order_number=o.order_number) AS reservation_state,(SELECT expires_at FROM checkout_reservations WHERE order_number=o.order_number) AS reserved_until FROM orders o JOIN member_orders mo ON mo.order_number=o.order_number WHERE mo.member_id=?';
    if(path!=='/api/member/orders') {
      const order=await env.DB.prepare(base+' AND o.order_number=?').bind(m.id,decodeURIComponent(path.slice('/api/member/orders/'.length))).first();
      if(!order)fail(404,'找不到此訂單');return json({success:true,order});
    }
    const page=Math.floor(Math.max(1,Math.min(100000,Number(url.searchParams.get('page'))||1)));
    const result=await env.DB.prepare(base+' ORDER BY o.id DESC LIMIT 21 OFFSET ?').bind(m.id,(page-1)*20).all();
    return json({success:true,orders:result.results.slice(0,20),hasMore:result.results.length>20});
  }
  if(path==='/api/payments/methods'&&method==='GET'){await session(request,env);return json({success:true,methods:methods(env,url.searchParams.get('country'))});}
  if(['/api/payments/start','/api/payments/confirm','/api/payments/bank/report'].includes(path)&&method==='POST'){
    const m=await session(request,env);sandbox(env);await rate(env,'payments:'+m.id,40);const data=await body(request);
    const order=await env.DB.prepare('SELECT o.*,mo.shipping_country FROM orders o JOIN member_orders mo ON mo.order_number=o.order_number WHERE o.order_number=? AND mo.member_id=?').bind(text(data.orderNumber,60,'訂單編號'),m.id).first();
    if(!order)fail(404,'找不到此訂單');
    if(path==='/api/payments/start')return json({success:true,...await start(order,env)});
    if(path==='/api/payments/confirm'){await confirm(order,env,data);return json({success:true});}
    if(order.payment!=='bank'||order.status!=='pending')fail(409,'此訂單無法回報匯款');
    if(!/^\d{5}$/.test(data.last5||'')||!/^\d{4}-\d{2}-\d{2}$/.test(data.date||''))fail(400,'請輸入匯款帳號末五碼與日期');
    const stamp=Date.parse(data.date+'T00:00:00+08:00');
    if(!Number.isFinite(stamp)||data.date>new Date(Date.now()+8*3600000).toISOString().slice(0,10)||data.date<new Date(Date.parse(order.created_at)+8*3600000).toISOString().slice(0,10))fail(400,'請確認匯款日期');
    const result=await env.DB.prepare("UPDATE payment_attempts SET remittance_last5=?,remittance_date=?,reported_at=? WHERE order_number=? AND provider='bank' AND due_at>? AND EXISTS(SELECT 1 FROM checkout_reservations r WHERE r.order_number=payment_attempts.order_number AND r.state='paying')").bind(data.last5,data.date,new Date().toISOString(),order.order_number,new Date().toISOString()).run();
    if(!result.meta.changes)fail(409,'匯款期限已過或尚未取得匯款資料');
    return json({success:true,message:'已收到回報，待人工核對；回報不代表付款完成'});
  }
  if(path==='/api/checkout/quote'&&method==='POST'){const m=await session(request,env);sandbox(env);await expireReservations(env);const d=await body(request),q=await discountQuote(env,await catalogQuote(env,d.items),d.coupon,m.id);await checkStock(env,q.items);if(d.country&&!COUNTRY_CODES.includes(d.country))fail(400,'請選擇收件國家');if(d.country&&d.country!=='TW'&&q.coupon?.gift_kind==='ink'&&q.coupon?.kind==='gift')fail(400,'墨水贈品僅寄送台灣');const firstGift=await firstGiftQuote(env,q.items,m.id,d.country);return json({success:true,...q,firstGift,coupon:q.coupon?.code||null});}
  if(path==='/api/payments/ecpay/start'&&method==='POST'){
    const m=await session(request,env);sandbox(env);const data=await body(request);
    const order=await env.DB.prepare('SELECT o.* FROM orders o JOIN member_orders mo ON mo.order_number=o.order_number WHERE o.order_number=? AND mo.member_id=?').bind(text(data.orderNumber,60,'訂單編號'),m.id).first();
    if(!order)fail(404,'找不到此訂單');return json({success:true,...paymentForm(order,env)});
  }
  if(path==='/api/order'&&method==='POST') {
    const m=await session(request,env);await rate(env,`orders:${m.id}`,30);
    const order=await body(request),c=order.customer||{},key=request.headers.get('Idempotency-Key');
    if(!key||!/^[a-zA-Z0-9-]{16,80}$/.test(key))fail(400,'請重新整理結帳頁後再試');
    const previous=await env.DB.prepare('SELECT order_number FROM member_orders WHERE member_id=? AND request_key=?').bind(m.id,key).first();
    if(previous)return json({success:true,orderNumber:previous.order_number});
    const name=text(c.name,100,'收件人姓名'),phone=text(c.phone,40,'電話'),address=text(c.address,500,'收件地址');
    if(!COUNTRY_CODES.includes(c.country))fail(400,'請選擇收件國家／地區');
    sandbox(env);
    await expireReservations(env);
    const q=await discountQuote(env,await catalogQuote(env,order.items),order.coupon,m.id),{items,total}=q,number='WG'+random().slice(0,18);
    if(c.country!=='TW'&&(items.some(i=>i.category==='ink')||q.coupon?.kind==='gift'&&q.coupon.gift_kind==='ink'))fail(400,'墨水（含贈品）僅寄送台灣，請移除墨水商品或更換優惠券後再結帳');
    const firstGift=await firstGiftQuote(env,items,m.id,c.country);if(firstGift?.kind==='ink'&&c.country!=='TW')fail(400,'墨水贈品僅寄送台灣');
    const shipping=text(order.shipping??'',40,'配送方式',false),payment=text(order.payment,30,'付款方式'),note=text(order.note??'',1000,'備註',false);
    if(methods(env,c.country)[payment]!==true)fail(400,'此付款方式尚未設定或不適用收件國家');
    if(order.expectedTotal!==total)fail(409,'商品金額已更新，請重新整理後確認');
    try{await env.DB.batch([
      ...catalogGuards(env,items),
      env.DB.prepare('INSERT INTO orders(order_number,customer_name,phone,email,address,shipping,payment,note,items,total,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(number,name,phone,m.email,address,shipping,payment,note+(q.gift?'\n優惠券贈品：'+q.gift:'')+(firstGift?'\n首購贈品：'+firstGift.description:''),JSON.stringify(items),total,'pending',new Date().toISOString()),
      env.DB.prepare('INSERT INTO member_orders(order_number,member_id,shipping_country,request_key) VALUES (?,?,?,?)').bind(number,m.id,c.country,key),
      ...reserveStatements(env,number,items,payment),...couponStatements(env,q,m.id,number),...firstGiftStatements(env,firstGift,m.id,number)
    ]);}catch(error){const retry=await env.DB.prepare('SELECT order_number FROM member_orders WHERE member_id=? AND request_key=?').bind(m.id,key).first();if(!retry){if(error.message?.includes('CHECK constraint failed: quantity'))fail(409,'商品庫存不足，請調整數量後再試');throw error;}return json({success:true,orderNumber:retry.order_number});}
    return json({success:true,orderNumber:number});
  }
  fail(404,'找不到此功能');
}
export default {
  async scheduled(event,env){if(env.APP_ENV==='staging'){await expireReservations(env);await reconcilePayments(env);}},
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    try{
      let response;
      if(url.pathname==='/'&&url.searchParams.get('homepage-preview')==='1'&&!await adminSession(request,env,false))response=new Response(null,{status:303,headers:{Location:'/admin-login.html','Cache-Control':'no-store'}});
      else if(url.pathname.startsWith('/media/'))response=await publicCommerce(request,env,url)||new Response(null,{status:404});
      else if(url.pathname.startsWith('/api/'))response=await api(request,env,url,ctx);
      else if((/^\/admin(?:\/|$)/i.test(url.pathname)||/^\/admin-(?!login(?:\.html)?\/?$)[^/.]+(?:\.html)?\/?$/i.test(url.pathname))&&!await adminSession(request,env,false))response=new Response(null,{status:303,headers:{Location:'/admin-login.html','Cache-Control':'no-store'}});
      else if(env.APP_ENV==='staging'&&url.pathname==='/robots.txt')response=new Response('User-agent: *\nDisallow: /\n',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
      else if(/^\/checkout(?:\.html)?\/?$/.test(url.pathname)&&!await session(request,env,false))response=new Response(null,{status:303,headers:{Location:'/member.html?next=checkout','Cache-Control':'no-store'}});
      else{
        const legacy=url.pathname.match(/^\/product-(egypt|fuji|huangshan|lushan|pojun|sihuang)(?:\.html)?\/?$/);
        if(/^\/category-(craft|special)(?:\.html)?\/?$/.test(url.pathname))return new Response(null,{status:302,headers:{Location:'/shop.html?category=pen','Cache-Control':'no-store'}});
        if(legacy)return new Response(null,{status:302,headers:{Location:'/product.html?family='+encodeURIComponent('product-'+legacy[1]),'Cache-Control':'no-store'}});
        response=await env.ASSETS.fetch(request);
        if(env.APP_ENV==='staging'&&response.headers.get('Content-Type')?.includes('text/html')&&!url.pathname.startsWith('/admin'))response=new HTMLRewriter().on('body',{element(el){el.prepend('<aside role="note" style="background:#fff1c2;color:#342300;padding:12px 16px;text-align:center;font:600 16px/1.5 sans-serif">網站建置中｜尚未開放正式收款，請勿匯款。</aside>',{html:true});}}).transform(response);
      }
      const result=new Response(response.body,response);
      result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('Referrer-Policy','same-origin');result.headers.set('X-Frame-Options','DENY');
      if(/^\/(?:admin|api\/admin)/i.test(url.pathname)||['/api/orders','/api/order/status'].includes(url.pathname)) {
        result.headers.set('Cache-Control','no-store');result.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
        result.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      }
      if(env.APP_ENV==='staging')result.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
      if(url.pathname==='/'&&url.searchParams.get('homepage-preview')==='1'){result.headers.set('X-Frame-Options','SAMEORIGIN');result.headers.set('Content-Security-Policy',"frame-ancestors 'self'");result.headers.set('Cache-Control','no-store');result.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');}
      if(/^\/(member|checkout)(\.html)?\/?$/.test(url.pathname))result.headers.set('Cache-Control','no-store');
      if(/^\/member(\.html)?\/?$/.test(url.pathname))result.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      return result;
    }catch(error){if(error.message?.includes('UNIQUE constraint failed: first_purchase_claims'))error=new HttpError(409,'首購贈品已由另一筆訂單保留，請重新整理後確認');if(error.message?.includes('CHECK constraint failed: ok'))error=new HttpError(409,'資料已變更，請重新整理後再操作');if(!(error instanceof HttpError)) console.error("Member request failed", error.name, error.message); return json({success:false,error:error instanceof HttpError||[400,404,405,409,503].includes(error.status)?error.message:'服務暫時無法使用，請稍後再試'},error.status||500,env.APP_ENV==='staging'?{'X-Robots-Tag':'noindex, nofollow, noarchive'}:{});}
  }
};
