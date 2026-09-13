const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const PDFDocument = require('pdfkit');
const multer = require('multer');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

const upload = multer({ dest: path.join(__dirname, 'uploads/') });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// --- Database Setup ---
const sqlite3 = require('sqlite3').verbose();
const dbFile = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbFile);

// Helper for Promisified Queries
const dbQuery = (query, params = []) => new Promise((resolve, reject) => {
  db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows));
});
const dbRun = (query, params = []) => new Promise((resolve, reject) => {
  db.run(query, params, function (err) { err ? reject(err) : resolve(this) });
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS store (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS history (
        slot INTEGER,
        date TEXT,
        time TEXT,
        shift TEXT,
        sku TEXT,
        batchCode TEXT,
        crates INTEGER,
        liters REAL,
        pieces INTEGER,
        looses INTEGER,
        PRIMARY KEY (slot, sku, batchCode, date, shift)
    )`);
});

// Initialization / Migration from data.json
async function initDB() {
  const row = await dbQuery("SELECT COUNT(*) as count FROM store");
  if (row[0].count === 0 && fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      const metaKeys = ['sku_master', 'categories', 'manager_setup', 'dashboard', 'settings', 'defects'];
      for (let key of metaKeys) {
        await dbRun("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", [key, JSON.stringify(data[key] || (key === 'settings' ? { shifts: [], admin_password: '1234', backup_path: '' } : []))]);
      }
      if (data.history && data.history.length > 0) {
        db.serialize(() => {
          const stmt = db.prepare(`INSERT OR REPLACE INTO history (slot, date, time, shift, sku, batchCode, crates, liters, pieces, looses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          data.history.forEach(h => {
            stmt.run(h.slot, h.date, h.time, h.shift, h.sku, h.batchCode || '', h.crates, h.liters, h.pieces, h.looses || 0);
          });
          stmt.finalize();
        });
      }
      fs.renameSync(DATA_FILE, DATA_FILE + '.migrated.json');
      console.log("Migrated data.json to SQLite database successfully.");
    } catch (e) { console.error("Migration failed", e); }
  } else if (row[0].count === 0 && !fs.existsSync(DATA_FILE)) {
    await dbRun("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", ['settings', JSON.stringify({ shifts: [{ id: 1, name: 'Shift 1', start: '06:00', end: '14:00' }, { id: 2, name: 'Shift 2', start: '14:00', end: '22:00' }, { id: 3, name: 'Shift 3', start: '22:00', end: '06:00' }], admin_password: '1234', backup_path: '' })]);
  }
}
initDB();

async function readAllData() {
  const data = { sku_master: [], categories: [], manager_setup: [], dashboard: [], history: [], settings: {}, defects: [] };
  const rows = await dbQuery("SELECT key, value FROM store");
  rows.forEach(r => { if (data.hasOwnProperty(r.key)) { data[r.key] = JSON.parse(r.value); } });
  const historyRows = await dbQuery("SELECT * FROM history ORDER BY rowid ASC");
  data.history = historyRows;
  return data;
}

function csvEscape(v) { return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`; }

// --- API Endpoints ---
app.get('/api/data', async (req, res) => {
  try { res.json(await readAllData()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/data', async (req, res) => {
  try {
    const payload = req.body;
    const metaKeys = ['sku_master', 'categories', 'manager_setup', 'dashboard', 'settings', 'defects'];
    for (let key of metaKeys) {
      if (payload[key]) {
        await dbRun("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", [key, JSON.stringify(payload[key])]);
      }
    }

    const settingsRaw = await dbQuery("SELECT value FROM store WHERE key='settings'");
    const settings = settingsRaw[0] ? JSON.parse(settingsRaw[0].value) : null;
    if (settings && settings.backup_path) {
      try {
        const backupDir = path.isAbsolute(settings.backup_path) ? settings.backup_path : path.resolve(settings.backup_path);
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const backupFile = path.join(backupDir, 'sku_backup_database.sqlite');
        fs.copyFileSync(dbFile, backupFile);
      } catch (err) { console.error('Backup failed:', err.message); }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/history', async (req, res) => {
  try {
    const h = req.body;
    await dbRun(`INSERT OR REPLACE INTO history (slot, date, time, shift, sku, batchCode, crates, liters, pieces, looses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [h.slot, h.date, h.time, h.shift, h.sku, h.batchCode || '', h.crates, h.liters, h.pieces, h.looses || 0]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Verify admin password
app.post('/api/verify-password', async (req, res) => {
  const data = await readAllData();
  res.json({ valid: req.body.password === data.settings.admin_password });
});

// Hard Reset (For Testing Only)
app.post('/api/hard-reset', async (req, res) => {
  try {
    console.log("HARD RESET TRIGGERED");
    await dbRun("DELETE FROM store");
    await dbRun("DELETE FROM history");
    const defaultSettings = {
      shifts: [
        { id: 1, name: 'Shift 1', start: '06:00', end: '14:00' },
        { id: 2, name: 'Shift 2', start: '14:00', end: '22:00' },
        { id: 3, name: 'Shift 3', start: '22:00', end: '06:00' }
      ],
      admin_password: '1234',
      backup_path: ''
    };
    await dbRun("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", ['settings', JSON.stringify(defaultSettings)]);
    await dbRun("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", ['sku_master', JSON.stringify([])]);
    await dbRun("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", ['categories', JSON.stringify([])]);
    await dbRun("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", ['manager_setup', JSON.stringify([])]);
    await dbRun("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", ['dashboard', JSON.stringify([])]);
    await dbRun("INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)", ['defects', JSON.stringify([])]);
    res.json({ success: true });
  } catch (err) {
    console.error("Reset Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Browse folder - returns list of folders
app.get('/api/browse-folders', (req, res) => {
  const dir = req.query.path || os.homedir();
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    const folders = items.filter(i => i.isDirectory() && !i.name.startsWith('.')).map(i => ({
      name: i.name, path: path.join(dir, i.name)
    }));
    const parent = path.dirname(dir);
    res.json({ current: dir, parent: parent !== dir ? parent : null, folders });
  } catch (err) { res.json({ current: dir, parent: path.dirname(dir), folders: [], error: err.message }); }
});

// Get available drives (Windows)
app.get('/api/drives', (req, res) => {
  if (process.platform === 'win32') {
    const { execSync } = require('child_process');
    try {
      const output = execSync('wmic logicaldisk get name', { encoding: 'utf-8' });
      const drives = output.split('\n').map(l => l.trim()).filter(l => /^[A-Z]:$/.test(l)).map(d => ({ name: d + '\\', path: d + '\\' }));
      res.json(drives);
    } catch (e) { res.json([{ name: 'C:\\', path: 'C:\\' }]); }
  } else { res.json([{ name: '/', path: '/' }]); }
});

// Download sample CSV for SKU import
app.get('/api/sample-csv', (req, res) => {
  const headers = ['Material Description', 'Material Code', 'Liters/Crate', 'Pieces/Crate', 'Liters/Piece', 'Category'];
  const sample = ['Example Product 500ml', 'EP500', '12', '24', '0.5', 'Beverages'];
  const csv = headers.join(',') + '\n' + sample.map(v => csvEscape(v)).join(',') + '\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=sku_sample_template.csv');
  res.send(csv);
});

// Upload CSV for SKU import
app.post('/api/upload-sku-csv', upload.single('file'), (req, res) => {
  try {
    const content = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path); // cleanup
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + at least 1 row' });
    const skus = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 4) continue;
      const desc = cols[0]?.trim(), code = cols[1]?.trim();
      const lpc = parseFloat(cols[2]) || 0, ppc = parseFloat(cols[3]) || 0;
      const lpp = parseFloat(cols[4]) || 0;
      const cat = cols[5]?.trim() || '';
      if (!desc || !code) continue;
      skus.push({ description: desc, code, combine: desc + ' - ' + code, litersPerCrate: lpc, piecesPerCrate: ppc, litersPerPiece: lpp, category: cat });
    }
    res.json({ success: true, skus, count: skus.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function parseCSVLine(line) {
  const result = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) { if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; } else if (ch === '"') { inQuotes = false; } else { current += ch; } }
    else { if (ch === '"') { inQuotes = true; } else if (ch === ',') { result.push(current); current = ''; } else { current += ch; } }
  }
  result.push(current);
  return result;
}

// Export ALL DATA as CSV
app.get('/api/export/csv', async (req, res) => {
  const data = await readAllData();
  let csv = '';

  // SKU Master
  csv += '=== SKU MASTER ===\n';
  csv += 'Material Description,Material Code,Combine,Liters/Crate,Pieces/Crate,Liters/Piece,Category\n';
  (data.sku_master || []).forEach(s => {
    csv += [s.description, s.code, s.combine, s.litersPerCrate, s.piecesPerCrate, s.litersPerPiece || 0, s.category].map(csvEscape).join(',') + '\n';
  });

  csv += '\n=== MANAGER SETUP ===\n';
  csv += 'Slot,Running SKU\n';
  (data.manager_setup || []).forEach(m => { csv += [m.slot, m.sku].map(csvEscape).join(',') + '\n'; });

  csv += '\n=== DASHBOARD ===\n';
  csv += 'Slot,SKU,Create Count,Batch Code,Looses\n';
  (data.dashboard || []).forEach(d => { csv += [d.slot, d.sku, d.createCount, d.batchCode, d.looses].map(csvEscape).join(',') + '\n'; });

  csv += '\n=== HISTORY ===\n';
  csv += 'Date,Time,Shift,SKU,Batch Code,Crates,Liters,Pieces,Looses\n';
  (data.history || []).forEach(h => {
    csv += [h.date, h.time, h.shift, h.sku, h.batchCode, h.crates, h.liters, h.pieces, h.looses].map(csvEscape).join(',') + '\n';
  });

  csv += '\n=== FACTORY DASHBOARD (Aggregated) ===\n';
  csv += 'SKU,Batch Code,Total Crates,Total Liters\n';
  const factAgg = {};
  (data.dashboard || []).forEach(d => {
    if (!d.sku) return;
    const skuInfo = (data.sku_master || []).find(s => s.combine === d.sku);
    const lpc = skuInfo ? skuInfo.litersPerCrate : 0;
    const key = d.sku + '|' + (d.batchCode || '');
    if (!factAgg[key]) factAgg[key] = { sku: d.sku, batch: d.batchCode, crates: 0, liters: 0 };
    factAgg[key].crates += d.createCount;
    factAgg[key].liters += d.createCount * lpc + (d.looses || 0);
  });
  Object.values(factAgg).forEach(r => { csv += [r.sku, r.batch, r.crates, r.liters].map(csvEscape).join(',') + '\n'; });

  csv += '\n=== SETTINGS ===\n';
  csv += 'Shift Name,Start,End\n';
  (data.settings.shifts || []).forEach(s => { csv += [s.name, s.start, s.end].map(csvEscape).join(',') + '\n'; });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=sku_complete_report.csv');
  res.send(csv);
});

// Export ALL DATA as PDF
app.get('/api/export/pdf', async (req, res) => {
  const data = await readAllData();
  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=sku_complete_report.pdf');
  doc.pipe(res);

  const startX = 30;
  const pageW = 842 - 60;

  function drawTitle(title) {
    doc.addPage({ layout: 'landscape' });
    doc.fontSize(16).font('Helvetica-Bold').fill('#1a56db').text(title, { align: 'left' });
    doc.moveDown(0.5);
    return doc.y;
  }

  function drawTable(headers, colWidths, rows, y) {
    // Header
    doc.font('Helvetica-Bold').fontSize(8);
    let x = startX;
    headers.forEach((h, i) => {
      doc.rect(x, y, colWidths[i], 18).fill('#1a56db').stroke();
      doc.fill('#fff').text(h, x + 2, y + 4, { width: colWidths[i] - 4, align: 'left' });
      x += colWidths[i];
    });
    y += 18;
    // Rows
    doc.font('Helvetica').fontSize(7);
    rows.forEach((row, idx) => {
      if (y > 540) {
        doc.addPage({ layout: 'landscape' });
        y = 30;
        doc.font('Helvetica-Bold').fontSize(8);
        x = startX;
        headers.forEach((h, i) => {
          doc.rect(x, y, colWidths[i], 18).fill('#1a56db').stroke();
          doc.fill('#fff').text(h, x + 2, y + 4, { width: colWidths[i] - 4, align: 'left' });
          x += colWidths[i];
        });
        y += 18;
        doc.font('Helvetica').fontSize(7);
      }
      const bg = idx % 2 === 0 ? '#f9fafb' : '#ffffff';
      x = startX;
      row.forEach((v, i) => {
        doc.rect(x, y, colWidths[i], 16).fill(bg).stroke('#e5e7eb');
        doc.fill('#111').text(String(v == null ? '' : v), x + 2, y + 3, { width: colWidths[i] - 4, align: 'left' });
        x += colWidths[i];
      });
      y += 16;
    });
    return y;
  }

  // Cover page
  doc.fontSize(24).font('Helvetica-Bold').fill('#1a56db').text('SKU Management', { align: 'center' });
  doc.fontSize(14).font('Helvetica').fill('#64748b').text('Complete Data Report', { align: 'center' });
  doc.moveDown(1);
  doc.fontSize(10).fill('#111').text('Generated: ' + new Date().toLocaleString(), { align: 'center' });

  // 1. SKU Master
  let y = drawTitle('1. SKU Master');
  const skuH = ['Description', 'Code', 'Combine', 'L/Crate', 'Pcs/Crate', 'L/Piece', 'Category'];
  const skuW = [130, 80, 180, 60, 60, 60, pageW - 570];
  const skuR = (data.sku_master || []).map(s => [s.description, s.code, s.combine, s.litersPerCrate, s.piecesPerCrate, s.litersPerPiece || 0, s.category || '']);
  drawTable(skuH, skuW, skuR, y);

  // 2. Manager Setup
  y = drawTitle('2. Manager Setup');
  drawTable(['Slot', 'Running SKU'], [100, pageW - 100], (data.manager_setup || []).map(m => [m.slot, m.sku]), y);

  // 3. Dashboard
  y = drawTitle('3. Dashboard');
  drawTable(['Slot', 'SKU', 'Create Count', 'Batch Code', 'Looses'], [60, 250, 80, 150, 80],
    (data.dashboard || []).map(d => [d.slot, d.sku, d.createCount, d.batchCode, d.looses]), y);

  // 4. History
  y = drawTitle('4. History');
  const hH = ['Date', 'Time', 'Shift', 'SKU', 'Batch', 'Crates', 'Liters', 'Pieces', 'Looses'];
  const hW = [70, 55, 55, 180, 100, 55, 55, 55, 55];
  const hR = (data.history || []).map(h => [h.date, h.time, h.shift, h.sku, h.batchCode, h.crates, h.liters, h.pieces, h.looses]);
  drawTable(hH, hW, hR, y);

  // 5. Factory Dashboard
  y = drawTitle('5. Factory Dashboard (Aggregated)');
  const factAgg = {};
  (data.dashboard || []).forEach(d => {
    if (!d.sku) return;
    const skuInfo = (data.sku_master || []).find(s => s.combine === d.sku);
    const lpc = skuInfo ? skuInfo.litersPerCrate : 0;
    const key = d.sku + '|' + (d.batchCode || '');
    if (!factAgg[key]) factAgg[key] = { sku: d.sku, batch: d.batchCode, crates: 0, liters: 0 };
    factAgg[key].crates += d.createCount;
    factAgg[key].liters += d.createCount * lpc + (d.looses || 0);
  });
  drawTable(['SKU', 'Batch Code', 'Total Crates', 'Total Liters'], [250, 200, 100, 100],
    Object.values(factAgg).map(r => [r.sku, r.batch, r.crates, r.liters.toFixed(3)]), y);

  // 6. Settings
  y = drawTitle('6. Settings - Shifts');
  drawTable(['Shift Name', 'Start Time', 'End Time'], [200, 150, 150],
    (data.settings.shifts || []).map(s => [s.name, s.start, s.end]), y);

  doc.end();
});

// Export PIVOT DATA as PDF
app.post('/api/export/pivot-pdf', (req, res) => {
  try {
    const { data, filters } = req.body;
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    res.setHeader('Content-disposition', `attachment; filename=Production_Pivot.pdf`);
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);
    doc.fontSize(18).text('Production Pivot Report', { align: 'center' });
    doc.moveDown(0.5);

    if (filters) {
      doc.fontSize(10).fillColor('#666');
      doc.text(`Filters applied -> From: ${filters.from || 'All'} | To: ${filters.to || 'All'} | Shift: ${filters.shift || 'All'} | SKU: ${filters.sku || 'All'}`, { align: 'center' });
      doc.moveDown(1.5);
    }

    doc.fillColor('#000');
    let y = doc.y;
    doc.font('Helvetica-Bold');
    doc.text('SKU', 30, y, { width: 250 });
    doc.text('Batch', 280, y, { width: 80 });
    doc.text('Crates', 360, y, { width: 50, align: 'right' });
    doc.text('Liters', 420, y, { width: 60, align: 'right' });
    doc.text('Pieces', 490, y, { width: 60, align: 'right' });
    doc.moveDown();
    doc.moveTo(30, doc.y).lineTo(560, doc.y).stroke();
    doc.moveDown(0.5);

    doc.font('Helvetica');
    data.forEach(row => {
      if (doc.y > 750) { doc.addPage(); }
      y = doc.y;
      const h = doc.heightOfString(row.sku, { width: 240 });
      doc.text(row.sku, 30, y, { width: 240 });
      doc.text(row.batch, 280, y, { width: 80 });
      doc.text(row.crates, 360, y, { width: 50, align: 'right' });
      doc.text(row.liters, 420, y, { width: 60, align: 'right' });
      doc.text(row.pieces, 490, y, { width: 60, align: 'right' });
      doc.y = y + h + 5;
      doc.moveTo(30, doc.y).lineTo(560, doc.y).strokeColor('#e2e8f0').stroke();
      doc.moveTo(30, doc.y).strokeColor('black');
      doc.moveDown(0.5);
    });

    doc.end();
  } catch (err) { res.status(500).json({ error: 'PDF export failed' }); }
});

// --- Start Server ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  let fallbackIP = '127.0.0.1';
  // Preferred interfaces in order of priority
  const names = Object.keys(interfaces).sort((a, b) => {
    const aLower = a.toLowerCase(), bLower = b.toLowerCase();
    const isAPref = aLower.includes('wi-fi') || aLower.includes('ethernet');
    const isBPref = bLower.includes('wi-fi') || bLower.includes('ethernet');
    if (isAPref && !isBPref) return -1;
    if (!isAPref && isBPref) return 1;
    return 0;
  });

  for (const name of names) {
    // Skip virtual/WSL interfaces if possible
    if (name.toLowerCase().includes('virtual') || name.toLowerCase().includes('vethernet') || name.toLowerCase().includes('wsl')) continue;
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  // If no preferred physical interface found, pick first available non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const localIP = getLocalIP();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  SKU Management Server Running! This app made by Shaikh Naushad Ibrahim, naushadwork.netlify.app`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}\n`);
});
