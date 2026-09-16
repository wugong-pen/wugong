CREATE TABLE IF NOT EXISTS homepage_settings (
 id TEXT PRIMARY KEY CHECK(id='home'), value TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), updated_at TEXT NOT NULL
);
