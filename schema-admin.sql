-- Administrator access is granted by the site owner through the database only.
CREATE TABLE IF NOT EXISTS admin_members (
 member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 granted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
 token_hash TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 password_snapshot TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS admin_audit (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL,
 action TEXT NOT NULL,
 order_number TEXT,
 previous_status TEXT,
 next_status TEXT,
 created_at TEXT NOT NULL
);
