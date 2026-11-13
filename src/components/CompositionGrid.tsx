// ============ 成品图组合网格（Canvas 渲染，应用已保存布局 + 水印） ============
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TRANSFORM, COMPOSITIONS, compositionLabel, defaultWatermark, parseLayout,
  type CompositionDef, type ImageRecord, type ImageTransform, type LayoutData,
} from "../types";
import { drawComposition } from "../render";

interface Props {
  images: ImageRecord[];
  member: string;
  onEdit: (def: CompositionDef) => void;
}

function getSlots(def: CompositionDef, images: ImageRecord[]): (ImageRecord | null)[] {
  const slots: (ImageRecord | null)[] = [];
  for (const part of def.inputParts) {
    slots.push(images.find(i => i.phase === "训练前" && i.body_part === part) ?? null);
    slots.push(images.find(i => i.phase === "训练后" && i.body_part === part) ?? null);
  }
  return slots;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 缩略图单元尺寸（2:3） */
const CELL_W = 120;
const CELL_H = 180;

/** 用与编辑器/导出一致的渲染逻辑（变换 + 水印）绘制卡片预览 */
function CompPreview({ def, images, layoutData }: {
  def: CompositionDef;
  images: ImageRecord[];
  layoutData: LayoutData | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slotRecords = useMemo(() => getSlots(def, images), [def, images]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const imgs: (HTMLImageElement | null)[] = [];
      for (const r of slotRecords) {
        if (!r) { imgs.push(null); continue; }
        try {
          imgs.push(await loadImage(`/api/image/${r.id}/thumb`));
        } catch { imgs.push(null); }
      }
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = CELL_W * 2;
      canvas.height = def.isGrid ? CELL_H * 2 : CELL_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // 变换：已保存布局 → crop 字段 → 默认（缺图槽位安全跳过）
      const slots = imgs.map((img, i) => {
        const r = slotRecords[i];
        if (!img || !r) return null;
        const t: ImageTransform = layoutData?.transforms[i] ?? {
          zoom: r.crop_scale || 1,
          cx: r.crop_x ?? 0.5,
          cy: r.crop_y ?? 0.5,
          rotation: r.crop_rotation || 0,
        };
        return { img, transform: t };
      });
      drawComposition(ctx, {
        slots,
        isGrid: def.isGrid,
        cropW: CELL_W,
        cropH: CELL_H,
        watermark: layoutData?.watermark ?? defaultWatermark(def.outputName),
        readings: slotRecords.map(r => r?.tape_reading ?? null),
      });
    })();
    return () => { cancelled = true; };
  }, [slotRecords, layoutData, def]);

  if (slotRecords.every(s => s === null)) {
    return <div className="thumb-empty">?</div>;
  }
  return <canvas ref={canvasRef} className="comp-canvas" />;
}

export function CompositionGrid({ images, member, onEdit }: Props) {
  const [layouts, setLayouts] = useState<Map<string, LayoutData>>(new Map());
  const [exportedSet, setExportedSet] = useState<Set<string>>(new Set());

  // 拉取该会员所有已保存布局
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/compositions/${encodeURIComponent(member)}`);
        const data = await res.json();
        if (cancelled) return;
        const map = new Map<string, LayoutData>();
        const exp = new Set<string>();
        for (const item of data.items ?? []) {
          if (item.exported === 1) exp.add(item.body_part);
          if (!item.layout) continue;
          const parsed = parseLayout(item.layout, undefined, item.body_part);
          if (parsed) map.set(item.body_part, parsed);
        }
        setLayouts(map);
        setExportedSet(exp);
      } catch { /* 无布局时回退 crop 字段 */ }
    })();
    return () => { cancelled = true; };
  }, [member]);

  const groups = [
    { label: "体态", items: COMPOSITIONS.filter(c => c.outputName.startsWith("体态")) },
    { label: "围度", items: COMPOSITIONS.filter(c => c.outputName.startsWith("围度")) },
  ];

  const readyCount = COMPOSITIONS.filter(def => getSlots(def, images).every(s => s !== null)).length;

  return (
    <div className="composition-area">
      <div className="area-header">
        <span className="overline">COMPOSITIONS</span>
        <h2>{member} · 成品图</h2>
        <span className="group-count">{readyCount}/{COMPOSITIONS.length} 就绪</span>
        <span className="area-sub">预览含保存的布局与水印 · 点击卡片进入编辑</span>
      </div>
      {groups.map(group => (
        <div key={group.label} className="comp-group">
          <h3 className="group-title">{group.label} <span className="group-count">{group.items.length} 张</span></h3>
          <div className="comp-grid">
            {group.items.map(def => {
              const slots = getSlots(def, images);
              const ready = slots.every(s => s !== null);
              const wasExported = exportedSet.has(def.outputName);
              const layoutData = (() => {
                const ld = layouts.get(def.outputName);
                return ld && ld.transforms.length === slots.length ? ld : null;
              })();
              return (
                <div key={def.outputName}
                  className={`comp-card ${ready ? "ready" : "missing"} ${wasExported ? "exported" : ""}`}
                  onClick={() => ready && onEdit(def)}>
                  <div className="comp-preview">
                    <CompPreview def={def} images={images} layoutData={layoutData} />
                  </div>
                  <div className="comp-info">
                    <span className="comp-name">{def.outputName}</span>
                    <span className={`comp-status ${wasExported ? "exported" : ready ? "ok" : "warn"}`}>
                      {wasExported ? "✓ 已导出" : ready ? "✓ 可编辑" : "⚠ 缺图"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
