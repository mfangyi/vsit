// ============ SQLite 数据库模块 ============
import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import type { AiConfig, ImageRecord } from "../types";

/** 应用数据目录（SQLite + 压缩图缓存）： %LOCALAPPDATA%\vsit */
export const APP_DATA_DIR = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "vsit");
export const DB_PATH = join(APP_DATA_DIR, "vsit.db");
/** 原始图根目录： 桌面\vsit\原始图 */
export const IMAGES_ROOT = join(homedir(), "Desktop", "vsit", "原始图");
/** 成品图根目录： 桌面\vsit\成品图 */
export const EXPORTS_ROOT = join(homedir(), "Desktop", "vsit", "成品图");

let db: Database | null = null;

export function initDb(): Database {
  if (db) return db;
  mkdirSync(APP_DATA_DIR, { recursive: true });
  db = new Database(DB_PATH, { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member TEXT NOT NULL,
      phase TEXT NOT NULL,
      filename TEXT NOT NULL,
      body_part TEXT,
      tape_reading REAL,
      crop_x REAL DEFAULT 0.5,
      crop_y REAL DEFAULT 0.5,
      crop_scale REAL DEFAULT 1,
      crop_rotation REAL DEFAULT 0,
      ai_confidence REAL,
      classified INTEGER DEFAULT 0,
      UNIQUE(member, phase, filename)
    );
    CREATE TABLE IF NOT EXISTS compositions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member TEXT NOT NULL,
      body_part TEXT NOT NULL,
      layout TEXT,
      exported INTEGER DEFAULT 0,
      UNIQUE(member, body_part)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

export function getDb(): Database {
  if (!db) initDb();
  return db!;
}

// ---- AI Config ----
export function getAiConfig(): AiConfig | null {
  const row = getDb().query("SELECT base_url, model, api_key FROM ai_config WHERE id = 1").get() as AiConfig | null;
  return row && row.base_url && row.model && row.api_key ? row : null;
}

export function saveAiConfig(config: AiConfig): void {
  getDb().exec("INSERT OR REPLACE INTO ai_config (id, base_url, model, api_key) VALUES (1, ?, ?, ?)",
    [config.base_url, config.model, config.api_key]);
}

export function deleteAiConfig(): void {
  getDb().exec("DELETE FROM ai_config WHERE id = 1");
}

// ---- Images ----
export function upsertImage(member: string, phase: string, filename: string): ImageRecord {
  getDb().exec(
    "INSERT OR IGNORE INTO images (member, phase, filename) VALUES (?, ?, ?)",
    [member, phase, filename]
  );
  return getDb().query(
    "SELECT * FROM images WHERE member = ? AND phase = ? AND filename = ?"
  ).get(member, phase, filename) as ImageRecord;
}

export function getImagesByMember(member: string): ImageRecord[] {
  return getDb().query(
    "SELECT * FROM images WHERE member = ? ORDER BY phase, filename"
  ).all(member) as ImageRecord[];
}

export function getImageById(id: number): ImageRecord | null {
  return getDb().query("SELECT * FROM images WHERE id = ?").get(id) as ImageRecord | null;
}

export function updateImage(id: number, fields: Partial<ImageRecord>): void {
  const allowed = ["body_part", "tape_reading", "crop_x", "crop_y", "crop_scale", "crop_rotation", "ai_confidence", "classified"];
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(value as string | number | null);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().exec(`UPDATE images SET ${sets.join(", ")} WHERE id = ?`, vals);
}

// ---- Compositions ----
export function saveComposition(member: string, bodyPart: string, layout: string): number {
  getDb().exec(
    "INSERT INTO compositions (member, body_part, layout) VALUES (?, ?, ?) ON CONFLICT(member, body_part) DO UPDATE SET layout = ?",
    [member, bodyPart, layout, layout]
  );
  const row = getDb().query("SELECT id FROM compositions WHERE member = ? AND body_part = ?").get(member, bodyPart) as { id: number } | null;
  return row?.id ?? 0;
}

export function markExported(member: string, bodyPart: string): void {
  getDb().exec(
    "INSERT INTO compositions (member, body_part, exported) VALUES (?, ?, 1) ON CONFLICT(member, body_part) DO UPDATE SET exported = 1",
    [member, bodyPart]
  );
}

export function getCompositionLayout(member: string, bodyPart: string): string | null {
  const row = getDb().query("SELECT layout FROM compositions WHERE member = ? AND body_part = ?").get(member, bodyPart) as { layout: string } | null;
  return row?.layout ?? null;
}

export function getCompositionsByMember(member: string): { body_part: string; layout: string | null; exported: number }[] {
  return getDb().query(
    "SELECT body_part, layout, exported FROM compositions WHERE member = ?"
  ).all(member) as { body_part: string; layout: string | null; exported: number }[];
}

/** 全部布局行（供全局水印覆盖遍历） */
export function getAllCompositionLayouts(): { id: number; member: string; body_part: string; layout: string | null }[] {
  return getDb().query("SELECT id, member, body_part, layout FROM compositions").all() as { id: number; member: string; body_part: string; layout: string | null }[];
}

export function updateCompositionLayoutById(id: number, layout: string): void {
  getDb().exec("UPDATE compositions SET layout = ? WHERE id = ?", [layout, id]);
}

// ---- Settings ----
export function getSetting(key: string): string | null {
  const row = getDb().query("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().exec("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?", [key, value, value]);
}

// ---- Member stats ----
export function getMemberStats(): Record<string, { total: number; classified: number }> {
  const rows = getDb().query(
    "SELECT member, COUNT(*) AS total, COALESCE(SUM(classified), 0) AS classified FROM images GROUP BY member"
  ).all() as { member: string; total: number; classified: number }[];
  const out: Record<string, { total: number; classified: number }> = {};
  for (const r of rows) out[r.member] = { total: r.total, classified: r.classified };
  return out;
}

// ---- Clear Data ----
export function clearAllData(): void {
  const d = getDb();
  d.exec("DELETE FROM images");
  d.exec("DELETE FROM compositions");
  d.exec("DELETE FROM ai_config");
  d.exec("DELETE FROM app_settings");
}
