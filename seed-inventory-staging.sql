-- TEST ONLY: never reset existing stock on repeated deployment.
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('product-egypt',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('product-fuji',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('product-huangshan',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('product-lushan',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('pojun-單尖',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('pojun-偃月刀尖',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('pojun-雙層特殊尖',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('pojun-逆雙層特殊尖',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('sihuang-brass-單尖',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('sihuang-brass-雙層特殊尖',5);
INSERT OR IGNORE INTO inventory(sku,available) VALUES ('sihuang-brass-逆雙層特殊尖',5);
