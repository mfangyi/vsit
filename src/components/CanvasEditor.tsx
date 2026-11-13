// ============ Canvas 拼合编辑器 ============
import { useState, useEffect, useRef, useCallback } from "react";
import { DEFAULT_TRANSFORM, defaultWatermark, parseLayout, type CompositionDef, type ImageRecord, type ImageTransform, type WatermarkConfig } from "../types";
import { drawComposition, baseScaleFor } from "../render";

interface Props {
  def: CompositionDef;
  images: ImageRecord[];
  member: string;
  onClose: () => void;
  onUpdateImage: (id: number, fields: Record<string, unknown>) => Promise<void>;
  onExport: (formData: FormData) => Promise<void>;
}

interface LoadedSlot {
  img: HTMLImageElement | null;
  record: ImageRecord | null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 裁剪区域比例（宽:高 = 2:3） */
const CROP_RATIO = 2 / 3;
/** 显示尺寸（每格） */
const DISP_CROP_H = 900;
const DISP_CROP_W = Math.round(DISP_CROP_H * CROP_RATIO);

export function CanvasEditor({ def, images, member, onClose, onUpdateImage, onExport }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [slots, setSlots] = useState<LoadedSlot[]>([]);
  const [transforms, setTransforms] = useState<ImageTransform[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [dirty, setDirty] = useState(false);
  const [wm, setWm] = useState<WatermarkConfig>(() => defaultWatermark(def.outputName));
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  // 稳定引用：父级刷新图片列表不应导致编辑器状态重置
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const isGrid = def.isGrid;
  const canvasW = DISP_CROP_W * 2;
  const canvasH = isGrid ? DISP_CROP_H * 2 : DISP_CROP_H;

  // 加载图片 + 已保存布局（仅切换成品图/重新进入时执行）
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const slotsDef: (ImageRecord | null)[] = [];
      for (const part of def.inputParts) {
        const imgs = imagesRef.current;
        slotsDef.push(imgs.find(i => i.phase === "训练前" && i.body_part === part) ?? null);
        slotsDef.push(imgs.find(i => i.phase === "训练后" && i.body_part === part) ?? null);
      }

      const loaded: LoadedSlot[] = [];
      for (const record of slotsDef) {
        if (record) {
          try {
            const img = await loadImage(`/api/image/${record.id}`);
            loaded.push({ img, record });
          } catch {
            loaded.push({ img: null, record });
          }
        } else {
          loaded.push({ img: null, record: null });
        }
      }

      // 读取已保存布局（compositions 表，v1 数组 / v2 对象+水印）
      let savedTransforms: ImageTransform[] | null = null;
      let savedWm: WatermarkConfig | null = null;
      try {
        const res = await fetch(`/api/compositions/${encodeURIComponent(member)}/${encodeURIComponent(def.outputName)}`);
        const data = await res.json();
        const parsed = parseLayout(data.layout, loaded.length, def.outputName);
        if (parsed) {
          savedTransforms = parsed.transforms;
          savedWm = parsed.watermark;
        }
      } catch { /* 无保存布局，用默认值 */ }

      if (cancelled) return;
      setSlots(loaded);
      setTransforms(loaded.map((s, i) => {
        const t = savedTransforms?.[i] ?? { ...DEFAULT_TRANSFORM };
        // 载入后按图片实际尺寸钳制，防止白边
        return s.img ? clampTransform(t, s.img.naturalWidth, s.img.naturalHeight) : t;
      }));
      setWm(savedWm ?? defaultWatermark(def.outputName));
      setDirty(false);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.outputName, member]);


  /** 精确钳制：裁剪窗口（含旋转包围盒）必须完全落在图片内，不允许白边 */
  const clampTransform = (t: ImageTransform, iw: number, ih: number): ImageTransform => {
    const rad = (t.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const s = baseScaleFor(t.rotation, iw, ih, DISP_CROP_W, DISP_CROP_H) * t.zoom;
    const hw = (DISP_CROP_W * cos + DISP_CROP_H * sin) / (2 * s);
    const hh = (DISP_CROP_W * sin + DISP_CROP_H * cos) / (2 * s);
    let cx = t.cx * iw;
    let cy = t.cy * ih;
    const minX = Math.min(hw, iw / 2), maxX = Math.max(iw - hw, iw / 2);
    const minY = Math.min(hh, ih / 2), maxY = Math.max(ih - hh, ih / 2);
    cx = Math.max(minX, Math.min(maxX, cx));
    cy = Math.max(minY, Math.min(maxY, cy));
    return { ...t, cx: cx / iw, cy: cy / ih };
  };

  // Draw function（共享渲染：预览/导出/卡片缩略图同一份代码）
  const drawAll = useCallback((ctx: CanvasRenderingContext2D, cropW: number, cropH: number) => {
    const drawSlots: ({ img: HTMLImageElement; transform: ImageTransform } | null)[] = slots.map((s, i) => {
      const t = transforms[i];
      return s.img && t ? { img: s.img, transform: t } : null;
    });
    const readings = slots.map(s => s.record?.tape_reading ?? null);
    drawComposition(ctx, { slots: drawSlots, isGrid, cropW, cropH, watermark: wm, readings });
    // 选中框
    const pos = isGrid
      ? [{ x: 0, y: 0 }, { x: cropW, y: 0 }, { x: 0, y: cropH }, { x: cropW, y: cropH }][selected]
      : [{ x: 0, y: 0 }, { x: cropW, y: 0 }][selected];
    if (pos) {
      ctx.strokeStyle = "#C9AD76";
      ctx.lineWidth = 3;
      ctx.strokeRect(pos.x + 1, pos.y + 1, cropW - 2, cropH - 2);
    }
  }, [slots, transforms, selected, isGrid, wm]);

  // Render display canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || loading) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawAll(ctx, DISP_CROP_W, DISP_CROP_H);
  }, [drawAll, loading, canvasW, canvasH]);

  // --- Mouse interactions ---
  const getSlotFromEvent = (e: React.MouseEvent): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvasW;
    const y = ((e.clientY - rect.top) / rect.height) * canvasH;
    if (isGrid) {
      if (x < DISP_CROP_W && y < DISP_CROP_H) return 0;
      if (x >= DISP_CROP_W && y < DISP_CROP_H) return 1;
      if (x < DISP_CROP_W && y >= DISP_CROP_H) return 2;
      return 3;
    }
    return x < DISP_CROP_W ? 0 : 1;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const idx = getSlotFromEvent(e);
    setSelected(idx);
    const t = transforms[idx];
    if (!t) return;
    dragRef.current = { x: e.clientX, y: e.clientY, cx: t.cx, cy: t.cy };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const idx = selected;
    const slot = slots[idx];
    const t = transforms[idx];
    if (!slot?.img || !t) return;
    const imgW = slot.img.naturalWidth;
    const imgH = slot.img.naturalHeight;

    // 屏幕像素 → 画布像素（考虑 CSS 缩放）
    const rect = canvas.getBoundingClientRect();
    const dxCanvas = (e.clientX - dragRef.current.x) * (canvasW / rect.width);
    const dyCanvas = (e.clientY - dragRef.current.y) * (canvasH / rect.height);

    const rad = (t.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const bboxW = imgW * cos + imgH * sin;
    const bboxH = imgW * sin + imgH * cos;
    const baseScale = Math.max(DISP_CROP_W / bboxW, DISP_CROP_H / bboxH);
    const totalScale = baseScale * t.zoom;

    const dxNorm = dxCanvas / totalScale / imgW;
    const dyNorm = dyCanvas / totalScale / imgH;
    updateTransform(idx, {
      cx: dragRef.current.cx - dxNorm,
      cy: dragRef.current.cy - dyNorm,
    });
  };

  const handleMouseUp = () => { dragRef.current = null; };

  // 原生滚轮监听（React onWheel 为 passive，preventDefault 无效）
  const wheelRef = useRef<(e: WheelEvent) => void>(null!);
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    const t = transforms[selected];
    if (!t) return;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    updateTransform(selected, { zoom: Math.max(1, Math.min(10, t.zoom * factor)) });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => wheelRef.current(e);
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [loading]);

  const updateTransform = (idx: number, partial: Partial<ImageTransform>) => {
    setDirty(true);
    setTransforms(prev => prev.map((t, i) => {
      if (i !== idx) return t;
      const merged = { ...t, ...partial };
      const img = slots[idx]?.img;
      if (!img) return merged;
      return clampTransform(merged, img.naturalWidth, img.naturalHeight);
    }));
  };

  // 自动保存：transforms / 水印变更防抖 1.5s 后静默写入
  useEffect(() => {
    if (loading || !dirty) return;
    const timer = setTimeout(() => { void persist(); }, 1500);
    return () => clearTimeout(timer);
  });

  // --- 保存布局：写入 compositions.layout + 每张图的 crop 字段（供一键导出使用） ---
  const persist = async () => {
    setSaveState("saving");
    try {
      // 1. 完整布局 → compositions 表
      const res = await fetch("/api/compositions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member,
          body_part: def.outputName,
          layout: JSON.stringify({ transforms, watermark: wm }),
        }),
      });
      if (!res.ok) throw new Error("保存布局失败");

      // 2. 每张图的裁剪参数 → images 表（一键导出读取这些字段）
      for (let i = 0; i < slots.length; i++) {
        const record = slots[i]?.record;
        const t = transforms[i];
        if (!record || !t) continue;
        await fetch(`/api/images/${record.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            crop_x: t.cx, crop_y: t.cy, crop_scale: t.zoom, crop_rotation: t.rotation,
          }),
        });
      }

      setSaveState("saved");
      setDirty(false);
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("idle");
      alert("保存失败，请重试");
    }
  };

  // --- Export ---
  const handleExport = async () => {
    setExporting(true);
    try {
      const maxH = Math.max(...slots.filter(s => s.img).map(s => s.img!.naturalHeight), 1000);
      const exportCropH = maxH;
      const exportCropW = Math.round(exportCropH * CROP_RATIO);
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = exportCropW * 2;
      exportCanvas.height = isGrid ? exportCropH * 2 : exportCropH;
      const ctx = exportCanvas.getContext("2d");
      if (!ctx) return;
      drawAll(ctx, exportCropW, exportCropH);

      const blob = await new Promise<Blob | null>(resolve =>
        exportCanvas.toBlob(resolve, "image/jpeg", 0.92)
      );
      if (!blob) throw new Error("Failed to create blob");

      const formData = new FormData();
      formData.append("member", member);
      formData.append("body_part", def.outputName);
      formData.append("layout", JSON.stringify(transforms));
      formData.append("image", blob, `${def.outputName}.jpg`);
      await onExport(formData);
      setExported(true);
      setSaveState("idle");
    } catch (e) {
      console.error("Export failed:", e);
      alert(`导出失败: ${e instanceof Error ? e.message : "未知错误"}`);
    }
    setExporting(false);
  };

  if (loading) return (
    <div className="canvas-editor loading">
      <div className="spinner" />
      正在加载图片...
    </div>
  );

  const selectedRecord = slots[selected]?.record;
  const selectedTransform = transforms[selected];

  // 围度读数本地更新（同步服务器，但不触发编辑器重置）
  const updateTape = (slotIdx: number, value: number | null) => {
    setDirty(true);
    setSlots(prev => prev.map((s, i) => {
      if (i !== slotIdx || !s.record) return s;
      return { ...s, record: { ...s.record, tape_reading: value } };
    }));
    const record = slots[slotIdx]?.record;
    if (record) void onUpdateImage(record.id, { tape_reading: value });
  };

  return (
    <div className="canvas-editor">
      <div className="editor-toolbar">
        <button className="btn btn-secondary" onClick={onClose}>← 返回</button>
        <h2 className="editor-title">{def.outputName}
          <span className="editor-badge">{def.isGrid ? "2×2 网格" : "左右拼合"}</span>
        </h2>
        <div className="toolbar-actions">
          <button className={`btn ${dirty ? "btn-primary" : "btn-secondary"}`} onClick={() => void persist()} disabled={saveState === "saving"}>
            {saveState === "saving" ? "保存中…" : dirty ? "● 保存布局" : "✓ 已保存"}
          </button>
          <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
            {exporting ? "导出中..." : exported ? "✓ 已导出" : "导出成品图"}
          </button>
        </div>
      </div>
      <div className="editor-body">
        <div className="editor-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={canvasW}
            height={canvasH}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="editor-canvas"
          />
          <div className="canvas-hint">
            <span><span className="hint-key">滚轮</span> 缩放</span>
            <span><span className="hint-key">拖拽</span> 平移</span>
            <span><span className="hint-key">点击</span> 选中图片</span>
          </div>
        </div>
        <div className="editor-controls">
          <h3>选中图片 #{selected + 1}</h3>
          {selectedRecord && (
            <div className="control-item">
              <div className="meta-line">部位 <strong>{selectedRecord.body_part}</strong></div>
              <div className="meta-line">阶段 <strong>{selectedRecord.phase}</strong></div>
            </div>
          )}
          {selectedTransform && (
            <>
              <div className="control-item">
                <label>缩放 <strong>{selectedTransform.zoom.toFixed(2)}x</strong></label>
                <input type="range" min={1} max={5} step={0.1}
                  value={selectedTransform.zoom}
                  onChange={e => updateTransform(selected, { zoom: parseFloat(e.target.value) })} />
              </div>
              <div className="control-item">
                <label>旋转 <strong>{selectedTransform.rotation}°</strong></label>
                <input type="range" min={-180} max={180} step={1}
                  value={selectedTransform.rotation}
                  onChange={e => updateTransform(selected, { rotation: parseFloat(e.target.value) })} />
                <button className="btn btn-secondary btn-sm" onClick={() => updateTransform(selected, { rotation: 0 })}>
                  重置旋转
                </button>
              </div>
              <button className="btn btn-secondary btn-sm btn-block"
                onClick={() => {
                  setDirty(true);
                  const img = slots[selected]?.img;
                  const t = { ...DEFAULT_TRANSFORM };
                  setTransforms(prev => prev.map((tt, i) => i === selected
                    ? (img ? clampTransform(t, img.naturalWidth, img.naturalHeight) : t)
                    : tt));
                }}>
                重置此图
              </button>
            </>
          )}
          <div className="tape-section">
            <h4>水印文字</h4>
            <div className="wm-item">
              <label>中央水印（半透明）</label>
              <input type="text" className="wm-input" value={wm.center}
                onChange={e => { setWm(w2 => ({ ...w2, center: e.target.value })); setDirty(true); }} />
            </div>
            <div className="wm-row">
              <div className="wm-item">
                <label>前字（红）</label>
                <input type="text" className="wm-input wm-sm" value={wm.before}
                  onChange={e => { setWm(w2 => ({ ...w2, before: e.target.value })); setDirty(true); }} />
              </div>
              <div className="wm-item">
                <label>后字（红）</label>
                <input type="text" className="wm-input wm-sm" value={wm.after}
                  onChange={e => { setWm(w2 => ({ ...w2, after: e.target.value })); setDirty(true); }} />
              </div>
            </div>
            <div className="wm-item">
              <label>底部标题（白）</label>
              <input type="text" className="wm-input" value={wm.title}
                onChange={e => { setWm(w2 => ({ ...w2, title: e.target.value })); setDirty(true); }} />
            </div>
          </div>
          {def.outputName.startsWith("围度") && (
            <div className="tape-section">
              <h4>软尺读数 (cm)</h4>
              {slots.map((slot, i) => slot.record && slot.record.body_part?.startsWith("围度") ? (
                <div key={i} className="tape-item">
                  <label>{slot.record.body_part} · {slot.record.phase}</label>
                  <input type="number" step={0.1} className="tape-input"
                    value={slot.record.tape_reading ?? ""}
                    onChange={e => updateTape(i, parseFloat(e.target.value) || null)}
                  />
                  <span className="tape-unit">cm</span>
                </div>
              ) : null)}
              <div className="tape-deltas">
                {Array.from(new Set(slots.map(s => s.record?.body_part).filter((p): p is string => !!p))).map(part => {
                  const b = slots.find(s => s.record?.body_part === part && s.record.phase === "训练前")?.record?.tape_reading ?? null;
                  const a = slots.find(s => s.record?.body_part === part && s.record.phase === "训练后")?.record?.tape_reading ?? null;
                  if (b == null || a == null) return null;
                  const d = Math.round((a - b) * 10) / 10;
                  return (
                    <div key={part} className="tape-delta">
                      {part.replace(/^围度-/, "")} {b} → {a}
                      <span className={d < 0 ? "down" : d > 0 ? "up" : "same"}>{d > 0 ? "+" : ""}{d}cm</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}