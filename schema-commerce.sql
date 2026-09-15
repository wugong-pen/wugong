CREATE TABLE IF NOT EXISTS products (
 sku TEXT PRIMARY KEY REFERENCES inventory(sku), family TEXT NOT NULL,
 name TEXT NOT NULL, variant TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL CHECK(category IN ('pen','ink','craft')),
 price INTEGER NOT NULL CHECK(price>0 AND price<=10000000),
 images TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_family ON products(family);
CREATE TABLE IF NOT EXISTS catalog_checks(ok INTEGER NOT NULL CHECK(ok=1));
CREATE TRIGGER IF NOT EXISTS catalog_checks_cleanup AFTER INSERT ON catalog_checks BEGIN DELETE FROM catalog_checks; END;
CREATE TABLE IF NOT EXISTS product_images (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS commerce_audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, before_value TEXT NOT NULL, after_value TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS commerce_audit_target ON commerce_audit(target,created_at);
CREATE TABLE IF NOT EXISTS order_management (order_number TEXT PRIMARY KEY REFERENCES orders(order_number), admin_note TEXT NOT NULL DEFAULT '', carrier TEXT NOT NULL DEFAULT '', tracking TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
