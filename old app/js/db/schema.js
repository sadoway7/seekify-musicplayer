/* ── table creation, seed data, reset ───────────────────────── */

const DBSchema = (() => {

  function ensureTables() {
    DBCore.r(`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      model TEXT DEFAULT '', serial_number TEXT DEFAULT '', status TEXT DEFAULT 'Available',
      location TEXT DEFAULT '', owner_account TEXT DEFAULT '', category TEXT DEFAULT 'General',
      barcode_id TEXT DEFAULT '', notes TEXT DEFAULT '',
      created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '', item_order REAL DEFAULT 1,
      deleted INTEGER DEFAULT 0, item_value TEXT DEFAULT '', sale_price TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1
    )`);
    // Safe migration: add columns if they don't exist yet
    try { DBCore.r('ALTER TABLE items ADD COLUMN deleted INTEGER DEFAULT 0'); } catch(e) {}
    try { DBCore.r('ALTER TABLE history ADD COLUMN changed_by TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN item_value TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN sale_price TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN quantity INTEGER DEFAULT 1'); } catch(e) {}
    try { DBCore.r('ALTER TABLE locations ADD COLUMN account_name TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE categories ADD COLUMN parent_category TEXT DEFAULT ""'); } catch(e) {}
    DBCore.r(`CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL, field_changed TEXT NOT NULL,
      old_value TEXT DEFAULT '', new_value TEXT DEFAULT '', changed_at TEXT DEFAULT '',
      changed_by TEXT DEFAULT ''
    )`);
    DBCore.r(`CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER DEFAULT 0,
      parent_category TEXT DEFAULT ''
    )`);
    DBCore.r(`CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER DEFAULT 0,
      account_name TEXT DEFAULT ''
    )`);
    DBCore.r(`CREATE TABLE IF NOT EXISTS statuses (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT DEFAULT '', sort_order INTEGER DEFAULT 0
    )`);
    DBCore.r(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, contact TEXT DEFAULT '', sort_order INTEGER DEFAULT 0
    )`);
    DBCore.r(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    DBCore.r(`CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT DEFAULT '',
      phone TEXT DEFAULT '', account_name TEXT DEFAULT '', role TEXT DEFAULT '',
      notes TEXT DEFAULT '', sort_order INTEGER DEFAULT 0
    )`);
    DBCore.r(`CREATE TABLE IF NOT EXISTS valuations (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL, year INTEGER NOT NULL,
      value_low TEXT DEFAULT '', value_high TEXT DEFAULT '',
      updated_at TEXT DEFAULT '',
      UNIQUE(item_id, year)
    )`);
    DBCore.r(`CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )`);
    try { DBCore.r('ALTER TABLE items ADD COLUMN tags TEXT DEFAULT ""'); } catch(e) {}
    // Safe migrations: add new columns if they don't exist
    try { DBCore.r('ALTER TABLE items ADD COLUMN assigned_to TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN brand TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN sku TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN part_number TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN imei TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN item_number TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN price_high TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN price_low TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN condition_type TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN condition_grade TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN boxed INTEGER DEFAULT 0'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN condition_notes TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN date_purchased TEXT DEFAULT ""'); } catch(e) {}
    try { DBCore.r('ALTER TABLE items ADD COLUMN date_sold TEXT DEFAULT ""'); } catch(e) {}

    // Seed additional tags (INSERT OR IGNORE skips existing)
    const extraTags = [
      { name: 'Leased', color: '#2563eb' },
      { name: 'Pending Disposal', color: '#78716c' },
      { name: 'Awaiting Repair', color: '#ea580c' },
      { name: 'Backup Unit', color: '#0891b2' },
      { name: 'Personal Use', color: '#7c3aed' },
      { name: 'Shared Asset', color: '#2563eb' },
      { name: 'Critical', color: '#dc2626' },
      { name: 'Decommissioned', color: '#78716c' },
      { name: 'New Purchase', color: '#16a34a' },
      { name: 'Refurbished', color: '#d97706' },
      { name: 'Surplus', color: '#64748b' },
      { name: 'Custom Config', color: '#7c3aed' },
      { name: 'Server Rack', color: '#4338ca' },
      { name: 'Travel Kit', color: '#0891b2' },
      { name: 'Remote Worker', color: '#2563eb' },
    ];
    extraTags.forEach((t, i) => {
      DBCore.r('INSERT OR IGNORE INTO tags (id, name, color, sort_order) VALUES (?, ?, ?, ?)', [_uid(), t.name, t.color, 100 + i]);
    });
  }

  /* ── individual seed functions ──────────────────────────────── */

  function seedStatuses() {
    const statuses = [
      { name: 'Available', color: '#16a34a' },
      { name: 'In Use', color: '#2563eb' },
      { name: 'In Field', color: '#d97706' },
      { name: 'With Client', color: '#7c3aed' },
      { name: 'Maintenance', color: '#ea580c' },
      { name: 'Sold', color: '#0891b2' },
      { name: 'Retired', color: '#64748b' },
      { name: 'Disposed', color: '#78716c' }
    ];
    statuses.forEach((s, i) => {
      DBCore.r('INSERT OR IGNORE INTO statuses (id, name, color, sort_order) VALUES (?, ?, ?, ?)', [_uid(), s.name, s.color, i]);
    });
  }

  function seedCategories() {
    const categories = [
      // Computers
      { name: 'Computers', parent: '' },
      { name: 'Laptops', parent: 'Computers' },
      { name: 'Desktops', parent: 'Computers' },
      { name: 'Servers', parent: 'Computers' },
      { name: 'Tablets', parent: 'Computers' },
      // Components
      { name: 'Components', parent: '' },
      { name: 'Storage Drives', parent: 'Components' },
      { name: 'Memory (RAM)', parent: 'Components' },
      { name: 'GPUs', parent: 'Components' },
      { name: 'CPUs', parent: 'Components' },
      { name: 'Motherboards', parent: 'Components' },
      { name: 'Power Supplies', parent: 'Components' },
      // Networking
      { name: 'Networking', parent: '' },
      { name: 'Routers', parent: 'Networking' },
      { name: 'Switches', parent: 'Networking' },
      { name: 'Access Points', parent: 'Networking' },
      { name: 'Firewalls', parent: 'Networking' },
      { name: 'Cables & Patch', parent: 'Networking' },
      // Peripherals
      { name: 'Peripherals', parent: '' },
      { name: 'Monitors', parent: 'Peripherals' },
      { name: 'Keyboards & Mice', parent: 'Peripherals' },
      { name: 'Headsets & Audio', parent: 'Peripherals' },
      { name: 'Webcams', parent: 'Peripherals' },
      { name: 'Docking Stations', parent: 'Peripherals' },
      { name: 'Speakers', parent: 'Peripherals' },
      { name: 'Styluses', parent: 'Peripherals' },
      // Printers & Scanners
      { name: 'Printers & Scanners', parent: '' },
      { name: 'Printers', parent: 'Printers & Scanners' },
      { name: 'Printer Cartridges', parent: 'Printers & Scanners' },
      { name: 'Scanners', parent: 'Printers & Scanners' },
      // Security
      { name: 'Security', parent: '' },
      { name: 'Cameras', parent: 'Security' },
      { name: 'Sensors', parent: 'Security' },
      { name: 'NVR / DVR', parent: 'Security' },
      { name: 'Access Control', parent: 'Security' },
      { name: 'Alarms', parent: 'Security' },
      // Power & Infrastructure
      { name: 'Power & Infrastructure', parent: '' },
      { name: 'UPS & Battery Backup', parent: 'Power & Infrastructure' },
      { name: 'PDUs', parent: 'Power & Infrastructure' },
      { name: 'Racks & Enclosures', parent: 'Power & Infrastructure' },
      { name: 'Surge Protectors', parent: 'Power & Infrastructure' },
      // Software
      { name: 'Software', parent: '' },
      { name: 'Operating Systems', parent: 'Software' },
      { name: 'Office Suite', parent: 'Software' },
      { name: 'Antivirus & Security', parent: 'Software' },
      { name: 'Development Tools', parent: 'Software' },
      { name: 'Licenses & Subscriptions', parent: 'Software' },
      // Mobile Devices
      { name: 'Mobile Devices', parent: '' },
      { name: 'Smartphones', parent: 'Mobile Devices' },
      { name: 'Hotspots', parent: 'Mobile Devices' },
      { name: 'Wearables', parent: 'Mobile Devices' },
      // Cables & Accessories
      { name: 'Cables & Accessories', parent: '' },
      { name: 'Video Cables', parent: 'Cables & Accessories' },
      { name: 'Network Cables', parent: 'Cables & Accessories' },
      { name: 'Power Cables', parent: 'Cables & Accessories' },
      { name: 'Adapters', parent: 'Cables & Accessories' },
      { name: 'Chargers & Hubs', parent: 'Cables & Accessories' },
      // Tools
      { name: 'Tools', parent: '' },
      { name: 'Hand Tools', parent: 'Tools' },
      { name: 'Power Tools', parent: 'Tools' },
      { name: 'Test Equipment', parent: 'Tools' },
      { name: 'Tool Kits', parent: 'Tools' },
      { name: 'Ladders & Lifts', parent: 'Tools' },
      // Supplies
      { name: 'Supplies', parent: '' },
      { name: 'Batteries', parent: 'Supplies' },
      { name: 'Toner & Ink', parent: 'Supplies' },
      { name: 'Paper & Stationery', parent: 'Supplies' },
      { name: 'Cleaning Supplies', parent: 'Supplies' },
      { name: 'Packaging & Shipping', parent: 'Supplies' },
      { name: 'Safety Equipment', parent: 'Supplies' },
      // General
      { name: 'General', parent: '' },
      { name: 'Furniture', parent: 'General' },
      { name: 'Vehicles', parent: 'General' },
      { name: 'Office Supplies', parent: 'General' },
      { name: 'Miscellaneous', parent: 'General' },
    ];
    categories.forEach((c, i) => {
      DBCore.r('INSERT OR IGNORE INTO categories (id, name, sort_order, parent_category) VALUES (?, ?, ?, ?)', [_uid(), c.name, i, c.parent]);
    });
  }

  function seedLocations() {
    ['Main Office', 'Warehouse', 'Server Room', 'Field', 'Client Site'].forEach((name, i) => {
      DBCore.r('INSERT OR IGNORE INTO locations (id, name, sort_order) VALUES (?, ?, ?)', [_uid(), name, i]);
    });
  }

  function seedAccounts() {
    [
      { name: 'Acme Corp', contact: '' },
      { name: 'TechStart LLC', contact: '' },
      { name: 'Delta Services', contact: '' }
    ].forEach((a, i) => {
      DBCore.r('INSERT OR IGNORE INTO accounts (id, name, contact, sort_order) VALUES (?, ?, ?, ?)', [_uid(), a.name, a.contact, i]);
    });
  }

  function seedItems() {
    const items = [
      ['MacBook Pro 16"', 'Developer laptop', 'MK213LL/A', 'C02XX1ABCDEF', 'In Use', 'Main Office', '', 'Laptops'],
      ['Dell Monitor 27"', '4K USB-C monitor', 'U2723QE', 'CN-0XX123', 'Available', 'Warehouse', '', 'Monitors'],
      ['Cisco Router', 'Core network router', 'ISR4321', 'FTX1234A87B', 'In Field', 'Client Site', 'Acme Corp', 'Routers'],
      ['HP LaserJet Pro', 'Network printer', 'M404dn', 'CNBKC12345', 'In Use', 'Main Office', '', 'Printers'],
      ['Tool Kit Premium', 'Technician toolkit', 'TK-500', '', 'Available', 'Warehouse', '', 'Tools'],
      ['Logitech C920', 'HD webcam', 'C920S', 'WP12345', 'Available', 'Warehouse', '', 'Webcams'],
      ['Ubiquiti AP', 'WiFi 6 access point', 'U6-Pro', 'FC8C12345678', 'In Field', 'Client Site', 'TechStart LLC', 'Access Points'],
      ['ThinkPad X1 Carbon', 'Field technician laptop', '21KH002Y', 'PF3ABC91', 'With Client', 'Client Site', 'Delta Services', 'Laptops'],
      ['Fluke Network Tester', 'Cable certification tester', 'DSX-8000', 'FN8823401', 'In Use', 'Server Room', '', 'Tools'],
      ['APC UPS 1500', 'Battery backup unit', 'BR1500G', '3B1839X01234', 'In Use', 'Server Room', '', 'UPS & Battery Backup'],
      ['Dell PowerEdge Server', 'Rack server - production', 'R750xs', 'SVR92831', 'In Use', 'Server Room', '', 'Servers'],
      ['Samsung Galaxy Tab S9', 'Field tablet for client demos', 'SM-X710', 'R38T71AX02', 'In Field', 'Client Site', 'Acme Corp', 'Tablets'],
    ];
    const now = new Date().toISOString();
    items.forEach((it) => {
      const id = _uid();
      DBCore.r(`INSERT INTO items (id,name,description,model,serial_number,status,location,owner_account,category,barcode_id,notes,created_at,updated_at,item_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,'',?, ?,1)`,
        [id, ...it, _barcodeId(), now, now]);
    });
  }

  /* ── convenience: seed everything (used on first launch) ──── */

  function seedData() {
    seedStatuses();
    seedCategories();
    seedLocations();
    seedAccounts();
    seedTags();
    seedItems();
    DBCore.touch();
  }

  function seedTags() {
    const tags = [
      { name: 'Fragile', color: '#dc2626' },
      { name: 'High Value', color: '#d97706' },
      { name: 'Expendable', color: '#64748b' },
      { name: 'Loaner', color: '#2563eb' },
      { name: 'Return Required', color: '#7c3aed' },
      { name: 'Do Not Sell', color: '#be123c' },
      { name: 'Warranty Active', color: '#16a34a' },
      { name: 'Out of Warranty', color: '#78716c' },
      { name: 'Insurance Required', color: '#4338ca' },
      { name: 'Calibration Needed', color: '#ea580c' },
      { name: 'Temperature Sensitive', color: '#0891b2' },
      { name: 'Hazmat', color: '#dc2626' },
      { name: 'Recall Issued', color: '#dc2626' },
      { name: 'End of Life', color: '#78716c' },
      { name: 'Prototype', color: '#ea580c' },
      { name: 'Government Restricted', color: '#4338ca' },
      { name: 'Leased', color: '#2563eb' },
      { name: 'Pending Disposal', color: '#78716c' },
      { name: 'Awaiting Repair', color: '#ea580c' },
      { name: 'Backup Unit', color: '#0891b2' },
      { name: 'Personal Use', color: '#7c3aed' },
      { name: 'Shared Asset', color: '#2563eb' },
      { name: 'Critical', color: '#dc2626' },
      { name: 'Decommissioned', color: '#78716c' },
      { name: 'New Purchase', color: '#16a34a' },
      { name: 'Refurbished', color: '#d97706' },
      { name: 'Surplus', color: '#64748b' },
      { name: 'Custom Config', color: '#7c3aed' },
      { name: 'Server Rack', color: '#4338ca' },
      { name: 'Travel Kit', color: '#0891b2' },
      { name: 'Remote Worker', color: '#2563eb' },
    ];
    tags.forEach((t, i) => {
      DBCore.r('INSERT OR IGNORE INTO tags (id, name, color, sort_order) VALUES (?, ?, ?, ?)', [_uid(), t.name, t.color, i]);
    });
  }

  /* ── selective reset ──────────────────────────────────────── */
  // options: { statuses: bool, categories: bool, locations: bool, accounts: bool, items: bool }
  // no args / undefined = seed everything (backward compatible)

  function reset(options) {
    // Always wipe ALL tables — checkboxes only control what gets re-seeded
    ['history','items','categories','locations','statuses','accounts','contacts','meta'].forEach(t => DBCore.r('DELETE FROM ' + t));

    // If no options given, seed everything (backward compatible)
    const all = !options;

    if (all || options.statuses)   seedStatuses();
    if (all || options.categories) seedCategories();
    if (all || options.locations)  seedLocations();
    if (all || options.accounts)   seedAccounts();
    if (all || options.items)      seedItems();

    DBCore.touch(); DBCore.scheduleSave();
  }

  return { ensureTables, seedData, seedStatuses, seedCategories, seedLocations, seedAccounts, seedItems, reset };
})();
