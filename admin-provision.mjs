// Generates SQL only. Never accepts passwords or assigns administrators publicly.
const [action,email]=process.argv.slice(2);
if(!['grant','revoke'].includes(action)||!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
 console.error('Usage: node admin-provision.mjs grant|revoke owner@example.com');process.exit(1);
}
const address="'"+email.trim().toLowerCase().replaceAll("'","''")+"'";
console.log(`DELETE FROM admin_sessions WHERE member_id IN (SELECT id FROM members WHERE email=${address});`);
if(action==='grant')console.log(`INSERT INTO admin_members(member_id,active,granted_at) SELECT id,1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM members WHERE email=${address} AND active=1 ON CONFLICT(member_id) DO UPDATE SET active=1,granted_at=excluded.granted_at;`);
else console.log(`UPDATE admin_members SET active=0 WHERE member_id IN (SELECT id FROM members WHERE email=${address});`);
console.log(`SELECT m.email,a.active FROM admin_members a JOIN members m ON m.id=a.member_id WHERE m.email=${address};`);
