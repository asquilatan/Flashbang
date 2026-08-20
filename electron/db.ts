import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import initSqlJs, { Database } from 'sql.js';

export interface AppSettings {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  captureHotkey: string;
  undoHotkey: string;
  pdfPageMode: 'fit_a4' | 'exact';
  pdfOrientation: 'auto' | 'portrait' | 'landscape';
}

const DEFAULT_SETTINGS: AppSettings = {
  x1: 100,
  y1: 100,
  x2: 800,
  y2: 600,
  captureHotkey: 'Shift+Z',
  undoHotkey: 'Shift+X',
  pdfPageMode: 'exact',
  pdfOrientation: 'auto',
};

let db: Database | null = null;
let dbPath = '';

export async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  dbPath = path.join(userDataPath, 'settings.db');

  let locateFile: ((file: string) => string) | undefined = undefined;
  try {
    const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
    locateFile = () => wasmPath;
  } catch {
    locateFile = (file) => path.join(__dirname, '../node_modules/sql.js/dist', file);
  }

  const SQL = await initSqlJs({
    locateFile,
  });

  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } catch (err) {
      console.error('Failed to load existing database, creating fresh one:', err);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  // Initialize table
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Ensure default keys exist
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const res = db.exec(`SELECT value FROM settings WHERE key = '${key}'`);
    if (!res || res.length === 0 || res[0].values.length === 0) {
      db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, JSON.stringify(value)]);
    }
  }

  saveDatabaseFile();
}

function saveDatabaseFile(): void {
  if (!db || !dbPath) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error('Error saving SQLite database to disk:', err);
  }
}

export function getStoredSettings(): AppSettings {
  if (!db) return { ...DEFAULT_SETTINGS };

  try {
    const res = db.exec(`SELECT key, value FROM settings`);
    if (!res || res.length === 0) return { ...DEFAULT_SETTINGS };

    const currentSettings: Record<string, any> = { ...DEFAULT_SETTINGS };
    const rows = res[0].values;
    for (const row of rows) {
      const key = row[0] as string;
      const rawVal = row[1] as string;
      try {
        currentSettings[key] = JSON.parse(rawVal);
      } catch {
        currentSettings[key] = rawVal;
      }
    }

    return currentSettings as AppSettings;
  } catch (err) {
    console.error('Error reading settings from SQLite:', err);
    return { ...DEFAULT_SETTINGS };
  }
}

export function updateStoredSettings(updates: Partial<AppSettings>): AppSettings {
  if (!db) return { ...DEFAULT_SETTINGS, ...updates };

  try {
    for (const [key, val] of Object.entries(updates)) {
      if (val !== undefined) {
        db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, JSON.stringify(val)]);
      }
    }
    saveDatabaseFile();
  } catch (err) {
    console.error('Error updating settings in SQLite:', err);
  }

  return getStoredSettings();
}
