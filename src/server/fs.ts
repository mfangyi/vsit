// ============ 文件系统操作模块 ============
import { readdirSync, existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { APP_DATA_DIR, IMAGES_ROOT, EXPORTS_ROOT } from "./db";
import type { ImageRecord } from "../types";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export function getMembers(): string[] {
  if (!existsSync(IMAGES_ROOT)) return [];
  try {
    return readdirSync(IMAGES_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch {
    return [];
  }
}

export function memberExists(name: string): boolean {
  return existsSync(join(IMAGES_ROOT, name));
}

/** 新建会员：创建 原始图\{name}\训练前 · 训练后 目录 */
export function createMemberDirs(name: string): void {
  mkdirSync(join(IMAGES_ROOT, name, "训练前"), { recursive: true });
  mkdirSync(join(IMAGES_ROOT, name, "训练后"), { recursive: true });
}

export function scanMemberImages(member: string): { phase: string; filename: string }[] {
  const results: { phase: string; filename: string }[] = [];
  for (const phase of ["训练前", "训练后"]) {
    const dir = join(IMAGES_ROOT, member, phase);
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir)
        .filter(f => IMAGE_EXTENSIONS.some(ext => f.toLowerCase().endsWith(ext)))
        .sort();
      for (const f of files) {
        results.push({ phase, filename: f });
      }
    } catch { /* skip */ }
  }
  return results;
}

export function getImageFilePath(record: ImageRecord): string {
  return join(IMAGES_ROOT, record.member, record.phase, record.filename);
}

export function getExportDir(member: string): string {
  const dir = join(EXPORTS_ROOT, member);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function exportImage(member: string, name: string, data: Uint8Array): string {
  const dir = getExportDir(member);
  const filepath = join(dir, `${name}.jpg`);
  writeFileSync(filepath, data);
  return filepath;
}

// ---- 压缩图缓存（%LOCALAPPDATA%\vsit\thumbs）----
export const THUMBS_DIR = join(APP_DATA_DIR, "thumbs");

export function getThumbPath(id: number): string {
  return join(THUMBS_DIR, `${id}.jpg`);
}

export function saveThumb(id: number, data: Uint8Array): void {
  mkdirSync(THUMBS_DIR, { recursive: true });
  writeFileSync(getThumbPath(id), data);
}

export function clearThumbs(): void {
  if (existsSync(THUMBS_DIR)) {
    for (const f of readdirSync(THUMBS_DIR)) {
      try { rmSync(join(THUMBS_DIR, f)); } catch { /* skip */ }
    }
  }
}

// ---- 海报输出：桌面\vsit\海报\{会员}\ ----
function postersRoot(): string {
  // IMAGES_ROOT = 桌面\vsit\原始图 → 同级 海报
  return join(IMAGES_ROOT, "..", "海报");
}

export function getPosterDir(member: string): string {
  const dir = join(postersRoot(), member);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function savePoster(member: string, filename: string, data: Uint8Array): string {
  const filepath = join(getPosterDir(member), filename);
  writeFileSync(filepath, data);
  return filepath;
}
// ---- 品牌素材（可上传替换，存 AppData）----
export const ASSETS_DIR = join(APP_DATA_DIR, "assets");

export function getAssetPath(kind: string): string | null {
  if (kind !== "logo" && kind !== "qr") return null;
  return join(ASSETS_DIR, `${kind}.png`);
}

export function saveAsset(kind: "logo" | "qr", data: Uint8Array): string {
  mkdirSync(ASSETS_DIR, { recursive: true });
  const filepath = join(ASSETS_DIR, `${kind}.png`);
  writeFileSync(filepath, data);
  return filepath;
}

export function deleteAsset(kind: "logo" | "qr"): void {
  const p = join(ASSETS_DIR, `${kind}.png`);
  if (existsSync(p)) rmSync(p, { force: true });
}