// ============ 长图海报渲染 ============
// 统一坐标方案：ctx.scale(SCALE) 一次，后续全部使用逻辑坐标 / 逻辑字号
import { drawComposition } from "./render";
import { DEFAULT_STORE_NAME, type CompositionDef, type ImageRecord, type ImageTransform, type WatermarkConfig } from "./types";

const FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif';

const W = 1080;              // 逻辑宽
const PAD = 48;
const COL_GAP = 16;
const COL_W = (W - PAD * 2 - COL_GAP) / 2;        // 484
const SIDE_H = Math.round(COL_W * 3 / 4);          // 363，4:3 成品
const GRID_H = Math.round(COL_W * 3 / 2);          // 726，2×2 成品
const ROW_GAP = 20;
const SCALE = 2;

const C = {
  bg: "#F7F5F1", card: "#FFFFFF", text: "#1F1D1A", text2: "#6B655C", text3: "#A39C90",
  line: "#EAE6DE", gold: "#A98B54", goldDeep: "#8F7440", goldSoft: "rgba(169,139,84,.08)",
  ok: "#4E7A5E", danger: "#B04A3F",
};

export interface PosterComp {
  def: CompositionDef;
  slots: ({ img: HTMLImageElement; transform: ImageTransform } | null)[];
  watermark: WatermarkConfig;
  readings: (number | null)[];
  isGrid: boolean;
}

export interface PosterTapeRow { label: string; before: number | null; after: number | null }

export interface PosterInput {
  member: string;
  dateText: string;
  storeName?: string;
  address: string;
  phone: string;
  logo?: HTMLImageElement | null;
  qr?: HTMLImageElement | null;
  comps: PosterComp[];
  tapeRows: PosterTapeRow[];
}

const isTapeComp = (c: PosterComp) => c.def.outputName.startsWith("围度");

function flowRows(items: PosterComp[]) {
  const rows: { pair: PosterComp[]; h: number }[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const pair = items.slice(i, i + 2);
    rows.push({ pair, h: pair.some(c => c.isGrid) ? GRID_H : SIDE_H });
  }
  return rows;
}

function footerBlockH(p: PosterInput): number {
  const leftH = (p.address ? 50 : 0) + (p.phone ? 58 : 0);
  const rightH = p.qr ? 26 + 116 + 26 : 0;
  if (!leftH && !rightH) return 70;
  return 26 + Math.max(leftH, rightH) + 30;
}

const HEADER_H = 254;
const SECTION_H = 84;
const TABLE_TITLE_H = 64;
const TABLE_ROW_H = 58;

function sectionH(title: string, yy: number, ctx: CanvasRenderingContext2D): number {
  ctx.strokeStyle = C.gold; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, yy + 34); ctx.lineTo(PAD + 26, yy + 34); ctx.stroke();
  ctx.font = `700 15px ${FONT}`;
  ctx.fillStyle = C.goldDeep;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(title, PAD + 38, yy + 34);
  const tw = ctx.measureText(title).width;
  ctx.strokeStyle = C.line;
  ctx.beginPath(); ctx.moveTo(PAD + 50 + tw, yy + 34); ctx.lineTo(W - PAD, yy + 34); ctx.stroke();
  return yy + SECTION_H - 30;
}

function drawFlow(ctx: CanvasRenderingContext2D, items: PosterComp[], y: number): number {
  for (const row of flowRows(items)) {
    row.pair.forEach((c, i) => {
      const x = PAD + i * (COL_W + COL_GAP);
      const h = c.isGrid ? GRID_H : SIDE_H;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = C.card;
      ctx.fillRect(0, 0, COL_W, h);
      drawComposition(ctx, {
        slots: c.slots,
        isGrid: c.isGrid,
        cropW: COL_W / 2,
        cropH: c.isGrid ? h / 2 : h,
        watermark: c.watermark,
        readings: c.readings,
      });
      ctx.restore();
    });
    y += row.h + ROW_GAP;
  }
  return y;
}

export function posterHeight(p: PosterInput): number {
  const posture = p.comps.filter(c => !isTapeComp(c));
  const tape = p.comps.filter(isTapeComp);
  let h = HEADER_H;
  if (posture.length) h += SECTION_H + flowRows(posture).reduce((a, r) => a + r.h + ROW_GAP, 0);
  if (tape.length) h += SECTION_H + flowRows(tape).reduce((a, r) => a + r.h + ROW_GAP, 0);
  if (p.tapeRows.some(r => r.before != null || r.after != null)) {
    h += TABLE_TITLE_H + 50 + p.tapeRows.filter(r => r.before != null || r.after != null).length * TABLE_ROW_H + 24;
  }
  h += footerBlockH(p) + 30;
  return Math.round(h);
}

export async function renderPoster(p: PosterInput): Promise<HTMLCanvasElement> {
  const H = posterHeight(p);
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  // 底
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // ---------- 页头（品牌区）----------
  let y = 44;
  const logoSize = 76;
  if (p.logo) {
    ctx.drawImage(p.logo, PAD, y, logoSize, logoSize);
  }
  const nameX = PAD + (p.logo ? logoSize + 22 : 0);
  ctx.textAlign = "left";
  ctx.font = `700 26px ${FONT}`; ctx.fillStyle = C.text;
  ctx.fillText(p.storeName || DEFAULT_STORE_NAME, nameX, y + 44);
  ctx.font = `600 11px ${FONT}`; ctx.fillStyle = C.gold;
  ctx.fillText("J M   Y O G A   ·   P I L A T E S", nameX, y + 68);
  y += logoSize + 38;

  ctx.textAlign = "center";
  ctx.font = `700 28px ${FONT}`; ctx.fillStyle = C.text;
  ctx.fillText("十天维密训练营 · 体态蜕变记录", W / 2, y);
  y += 40;
  ctx.font = `600 20px ${FONT}`; ctx.fillStyle = C.goldDeep;
  ctx.fillText(p.member, W / 2, y);
  y += 24;
  ctx.font = `400 12px ${FONT}`; ctx.fillStyle = C.text3;
  ctx.fillText(p.dateText, W / 2, y);
  y += 22;
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  y += 18;
  // ---------- 图片区 ----------
  const posture = p.comps.filter(c => !isTapeComp(c));
  const tape = p.comps.filter(isTapeComp);
  if (posture.length) {
    y = sectionH("体态对比", y, ctx);
    y = drawFlow(ctx, posture, y);
  }
  if (tape.length) {
    y = sectionH("围度对比", y, ctx);
    y = drawFlow(ctx, tape, y);
  }

  // ---------- 数据表 ----------
  const shownRows = p.tapeRows.filter(r => r.before != null || r.after != null);
  if (shownRows.length) {
    ctx.textBaseline = "alphabetic";
    y = sectionH("围度变化数据（cm）", y, ctx) + 8;
    const TX = [PAD + 18, PAD + 300, PAD + 560, PAD + 820];
    ctx.fillStyle = C.goldSoft;
    ctx.fillRect(PAD, y, W - PAD * 2, 50);
    ctx.font = `600 13px ${FONT}`; ctx.fillStyle = C.goldDeep; ctx.textAlign = "left";
    ctx.fillText("部位", TX[0]!, y + 32); ctx.fillText("训练前", TX[1]!, y + 32);
    ctx.fillText("训练后", TX[2]!, y + 32); ctx.fillText("变化", TX[3]!, y + 32);
    y += 56;
    shownRows.forEach((r, idx) => {
      if (idx % 2 === 1) { ctx.fillStyle = "rgba(169,139,84,.04)"; ctx.fillRect(PAD, y, W - PAD * 2, TABLE_ROW_H - 4); }
      ctx.textAlign = "left";
      ctx.font = `500 14px ${FONT}`; ctx.fillStyle = C.text;
      ctx.fillText(r.label, TX[0]!, y + 34);
      ctx.fillStyle = C.text2;
      ctx.fillText(r.before == null ? "—" : String(r.before), TX[1]!, y + 34);
      ctx.fillText(r.after == null ? "—" : String(r.after), TX[2]!, y + 34);
      if (r.before != null && r.after != null) {
        const d = Math.round((r.after - r.before) * 10) / 10;
        ctx.fillStyle = d < 0 ? C.ok : d > 0 ? C.danger : C.text3;
        ctx.font = `700 14px ${FONT}`;
        ctx.fillText(d > 0 ? `+${d}` : String(d), TX[3]!, y + 34);
      } else {
        ctx.fillText("—", TX[3]!, y + 34);
      }
      y += TABLE_ROW_H;
    });
    y += 20;
  }

  // ---------- 页脚（门店信息 + 二维码）----------
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  const fy = y + 26;

  let lx = PAD + 8;
  ctx.textAlign = "left";
  if (p.address) {
    ctx.font = `600 10.5px ${FONT}`; ctx.fillStyle = C.gold;
    ctx.fillText("门 店 地 址", lx, fy + 10);
    ctx.font = `400 13px ${FONT}`; ctx.fillStyle = C.text2;
    ctx.fillText(p.address, lx, fy + 34);
  }
  if (p.phone) {
    const py = p.address ? fy + 58 : fy;
    ctx.font = `600 10.5px ${FONT}`; ctx.fillStyle = C.gold;
    ctx.fillText("联 系 电 话", lx, py + 10);
    ctx.font = `700 16px ${FONT}`; ctx.fillStyle = C.goldDeep;
    ctx.fillText(p.phone, lx, py + 36);
  }

  if (p.qr) {
    const qs = 116;
    const qx = W - PAD - qs - 8;
    const qy = fy - 4;
    ctx.fillStyle = C.card;
    ctx.fillRect(qx - 6, qy - 6, qs + 12, qs + 12);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    ctx.strokeRect(qx - 6, qy - 6, qs + 12, qs + 12);
    ctx.drawImage(p.qr, qx, qy, qs, qs);
    ctx.textAlign = "center";
    ctx.font = `400 10.5px ${FONT}`; ctx.fillStyle = C.text3;
    ctx.fillText("微信扫码 · 立即预约", qx + qs / 2, qy + qs + 18);
  }
  return canvas;
}

/** 围度数据表行（8 项固定顺序，取该会员前后读数） */
export function buildTapeRows(images: ImageRecord[]): PosterTapeRow[] {
  const parts: { key: string; label: string }[] = [
    { key: "手臂-左", label: "左臂围度" },
    { key: "手臂-右", label: "右臂围度" },
    { key: "大腿-左", label: "左大腿围度" },
    { key: "大腿-右", label: "右大腿围度" },
    { key: "肋骨", label: "肋骨围度" },
    { key: "上腹", label: "上腹围度" },
    { key: "中腹", label: "中腹围度" },
    { key: "下腹", label: "下腹围度" },
  ];
  return parts.map(({ key, label }) => {
    const find = (phase: string) =>
      images.find(i => i.body_part === `围度-${key}` && i.phase === phase && i.classified === 1) ?? null;
    const b = find("训练前");
    const a = find("训练后");
    return {
      label,
      before: b?.tape_reading ?? null,
      after: a?.tape_reading ?? null,
    };
  });
}

/** 海报图片顺序（运营定稿；未列出的成品自动追加在末尾） */
export const POSTER_ORDER: string[] = [
  "体态-全身-正面垂手", "体态-全身-正面抬手",
  "体态-全身-背面垂手", "体态-全身-背面抬手",
  "体态-全身-左面垂手", "体态-全身-左面抬手",
  "体态-全身-右面垂手", "体态-全身-右面抬手",
  "体态-背部上肢-右", "体态-背部上肢-左", "体态-背部",
  "围度-手臂", "围度-大腿", "围度-肋骨", "围度-上腹", "围度-中腹", "围度-下腹",
];