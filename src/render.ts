// ============ 共享渲染模块：成品图拼合 + 水印 ============
// CanvasEditor（预览/导出）、App（一键导出）、CompositionGrid（卡片缩略图）
// 全部使用此模块，保证所见即所得。
import { type ImageTransform, type WatermarkConfig } from "./types";

const WM_FONT = '"Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif';

/** 旋转后图片的覆盖基准缩放 */
export function baseScaleFor(
  rotation: number, iw: number, ih: number, cropW: number, cropH: number,
): number {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bboxW = iw * cos + ih * sin;
  const bboxH = iw * sin + ih * cos;
  return Math.max(cropW / bboxW, cropH / bboxH);
}

/** 水印：中央半透明 + 前/后红字 + 底部白色标题（尺寸按画布比例，预览与导出一致） */
export function drawWatermarks(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  isGrid: boolean,
  wm: WatermarkConfig,
  readings?: (number | null)[],
): void {
  const cellW = W / 2;
  const cellH = isGrid ? H / 2 : H;
  const titleSize = H * (isGrid ? 0.032 : 0.048);

  // 1. 中央半透明水印
  if (wm.center) {
    const size = titleSize;
    ctx.save();
    ctx.font = `bold ${size}px ${WM_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.30)";
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = size * 0.1;
    ctx.fillText(wm.center, W / 2, H / 2);
    ctx.restore();
  }

  // 2. 前/后 红字 + 围度读数（偶数槽=前，奇数槽=后；2×2 网格每行都标）
  const pad = cellH * 0.035;
  const badgeSize = cellH * 0.085;
  const cells = isGrid ? 4 : 2;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < cells; i++) {
    const text = i % 2 === 0 ? wm.before : wm.after;
    const x = (i % 2) * cellW + pad;
    const y = (isGrid ? Math.floor(i / 2) : 0) * cellH + pad;
    if (text) {
      ctx.font = `bold ${badgeSize}px ${WM_FONT}`;
      ctx.fillStyle = "rgba(224,32,32,0.92)";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = badgeSize * 0.08;
      ctx.fillText(text, x, y);
    }
    // 围度读数：标在 前/后 字的下一行，字号与底部标题一致
    const reading = readings?.[i];
    if (reading != null) {
      const txt = `${parseFloat(reading.toFixed(1))}cm`;
      ctx.font = `bold ${titleSize}px ${WM_FONT}`;
      ctx.fillStyle = "rgba(224,32,32,0.92)";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = titleSize * 0.08;
      ctx.fillText(txt, x, y + badgeSize + titleSize * 0.2);
    }
  }
  ctx.restore();

  // 3. 底部中央白色标题
  if (wm.title) {
    const size = titleSize;
    ctx.save();
    ctx.font = `bold ${size}px ${WM_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = size * 0.15;
    ctx.fillText(wm.title, W / 2, H - size * 0.45);
    ctx.restore();
  }
}

export interface DrawSlot {
  img: HTMLImageElement;
  transform: ImageTransform;
}

/** 完整拼合绘制（背景 + 各槽位图 + 水印） */
export function drawComposition(
  ctx: CanvasRenderingContext2D,
  opts: {
    slots: (DrawSlot | null)[];
    isGrid: boolean;
    cropW: number;
    cropH: number;
    watermark: WatermarkConfig;
    readings?: (number | null)[];
  },
): void {
  const { slots, isGrid, cropW, cropH, watermark, readings } = opts;
  const W = cropW * 2;
  const H = isGrid ? cropH * 2 : cropH;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  const positions: { x: number; y: number }[] = isGrid
    ? [{ x: 0, y: 0 }, { x: cropW, y: 0 }, { x: 0, y: cropH }, { x: cropW, y: cropH }]
    : [{ x: 0, y: 0 }, { x: cropW, y: 0 }];

  slots.forEach((slot, i) => {
    if (!slot) return;
    const { img, transform: t } = slot;
    const pos = positions[i]!;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const rad = (t.rotation * Math.PI) / 180;
    const s = baseScaleFor(t.rotation, iw, ih, cropW, cropH) * t.zoom;
    const cx = t.cx * iw, cy = t.cy * ih;
    ctx.save();
    ctx.beginPath();
    ctx.rect(pos.x, pos.y, cropW, cropH);
    ctx.clip();
    ctx.translate(pos.x + cropW / 2, pos.y + cropH / 2);
    ctx.rotate(rad);
    ctx.scale(s, s);
    ctx.drawImage(img, -cx, -cy);
    ctx.restore();
  });

  drawWatermarks(ctx, W, H, isGrid, watermark, readings);
}
