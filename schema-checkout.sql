-- Additive migration. Inventory is explicitly seeded separately for staging only.
CREATE TABLE IF NOT EXISTS inventory (
 sku TEXT PRIMARY KEY,
 available INTEGER NOT NULL CHECK(available>=0),
 sold INTEGER NOT NULL DEFAULT 0 CHECK(sold>=0)
);
CREATE TABLE IF NOT EXISTS checkout_reservations (
 order_number TEXT PRIMARY KEY REFERENCES orders(order_number),
 state TEXT NOT NULL CHECK(state IN ('held','paying','sold','released')),
 expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checkout_lines (
 order_number TEXT NOT NULL REFERENCES checkout_reservations(order_number),
 sku TEXT NOT NULL REFERENCES inventory(sku),
 quantity INTEGER NOT NULL CHECK(quantity>0 AND quantity<=99),
 PRIMARY KEY(order_number,sku)
);
CREATE TABLE IF NOT EXISTS payment_receipts (
 order_number TEXT PRIMARY KEY REFERENCES orders(order_number),
 provider TEXT NOT NULL,
 transaction_id TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount>0),
 currency TEXT NOT NULL CHECK(currency='TWD'),
 verified_at TEXT NOT NULL,
 UNIQUE(provider,transaction_id)
);
CREATE INDEX IF NOT EXISTS reservations_expiry ON checkout_reservations(state,expires_at);

CREATE TABLE IF NOT EXISTS payment_checks(order_number TEXT PRIMARY KEY, checked_at TEXT NOT NULL);
