// ============ 识别结果列表（查看 + 手动修正 + 点击放大核对） ============
import { useState, useRef, useEffect, useCallback } from "react";
import { BODY_PARTS, type ImageRecord } from "../types";

interface Props {
  images: ImageRecord[];
  onUpdate: (id: number, fields: Record<string, unknown>) => Promise<void>;
}

export function ImageClassifier({ images, onUpdate }: Props) {
  const [filter, setFilter] = useState<"all" | "unclassified" | "tape" | "unread">("all");

  const nUnc = images.filter(i => !i.classified).length;
  const nTape = images.filter(i => i.body_part?.startsWith("围度")).length;
  const nUnread = images.filter(i => i.classified === 1 && i.body_part?.startsWith("围度") && i.tape_reading == null).length;
  const shown = images.filter(i => {
    if (filter === "unclassified") return !i.classified;
    if (filter === "tape") return !!i.body_part?.startsWith("围度");
    if (filter === "unread") return i.classified === 1 && !!i.body_part?.startsWith("围度") && i.tape_reading == null;
    return true;
  });
  // 检测同阶段内重复分类（如两条大腿都判了"右"），提示人工修正
  const dupIds = new Set<number>();
  const seen = new Map<string, number>();
  for (const img of images) {
    if (!img.classified || !img.body_part) continue;
    const key = `${img.phase}|${img.body_part}`;
    const prev = seen.get(key);
    if (prev !== undefined) { dupIds.add(prev); dupIds.add(img.id); }
    else seen.set(key, img.id);
  }
  const phases: { label: string; phase: string }[] = [
    { label: "训练前", phase: "训练前" },
    { label: "训练后", phase: "训练后" },
  ];

  // ---- 放大预览状态 ----
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // 软尺读数本地乐观更新（避免受控输入被异步刷新打断）
  const [localTape, setLocalTape] = useState<Map<number, number | null>>(new Map());

  const previewIdx = images.findIndex(i => i.id === previewId);
  const preview = previewIdx >= 0 ? images[previewIdx] : null;

  const openPreview = useCallback((id: number) => {
    setPreviewId(id);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const closePreview = useCallback(() => setPreviewId(null), []);

  const navigate = useCallback((dir: 1 | -1) => {
    if (previewIdx < 0) return;
    const next = (previewIdx + dir + images.length) % images.length;
    setPreviewId(images[next]!.id);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [previewIdx, images]);

  // 原生滚轮缩放（以光标为中心）
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !preview) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setZoom(z => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const nz = Math.max(1, Math.min(12, z * factor));
        if (nz === z) return z;
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        setPan(p => ({
          x: cx - (cx - p.x) * (nz / z),
          y: cy - (cy - p.y) * (nz / z),
        }));
        return nz;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [preview]);

  // 键盘：Esc 关闭 / 左右切换
  useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
      else if (e.key === "ArrowLeft") navigate(-1);
      else if (e.key === "ArrowRight") navigate(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preview, closePreview, navigate]);

  const handlePreviewMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };

  const handlePreviewMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.px + (e.clientX - dragRef.current.x),
      y: dragRef.current.py + (e.clientY - dragRef.current.y),
    });
  }, []);

  const endDrag = useCallback(() => { dragRef.current = null; setDragging(false); }, []);

  const tapeValue = (img: ImageRecord): number | null =>
    localTape.has(img.id) ? localTape.get(img.id)! : img.tape_reading;

  const updateTape = (id: number, value: number | null) => {
    setLocalTape(prev => new Map(prev).set(id, value));
    void onUpdate(id, { tape_reading: value });
  };

  return (
    <div className="classifier-area">
      <div className="area-header">
        <span className="overline">RESULTS</span>
        <h2>识别结果</h2>
        <span className="area-sub">点击缩略图可放大核对软尺读数 · 下拉可修正分类</span>
      </div>
      <div className="filter-chips">
        {([["all", "全部"], ["unclassified", `未识别(${nUnc})`], ["tape", `围度(${nTape})`], ["unread", `待读数(${nUnread})`]] as const).map(([key, text]) => (
          <button key={key} className={`filter-chip ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>{text}</button>
        ))}
      </div>
      {phases.map(({ label, phase }) => (
        <div key={phase} className="classifier-group">
          <h3 className="group-title">{label} <span className="group-count">{shown.filter(i => i.phase === phase).length} 张</span></h3>
          <div className="classifier-list">
            {shown.filter(i => i.phase === phase).map(img => (
              <div key={img.id} className={`classifier-row ${img.classified ? "" : "unclassified"}`}>
                <img className="classifier-thumb" src={`/api/image/${img.id}/thumb`} loading="lazy" alt=""
                  onClick={() => openPreview(img.id)} title="点击放大" />
                <div className="classifier-main">
                  <div className="classifier-filename" title={img.filename}>{img.filename}</div>
                  <div className="classifier-controls">
                    <select
                      className={`classifier-select ${img.classified ? "" : "warn"}`}
                      value={img.body_part ?? ""}
                      onChange={e => onUpdate(img.id, { body_part: e.target.value || null, classified: e.target.value ? 1 : 0 })}
                    >
                      <option value="">— 未识别 —</option>
                      {(BODY_PARTS as readonly string[]).map(p => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    {img.body_part?.startsWith("围度") && (
                      <span className="tape-edit">
                        <input type="number" step={0.1} className="tape-input"
                          value={tapeValue(img) ?? ""}
                          onChange={e => updateTape(img.id, parseFloat(e.target.value) || null)}
                        />
                        <span className="tape-unit">cm</span>
                      </span>
                    )}
                    {dupIds.has(img.id) && (
                      <span className="conf-badge low" title="同部位重复，请人工核对左右">⚠ 重复</span>
                    )}
                    {img.classified === 1 && img.ai_confidence != null && (
                      <span className={`conf-badge ${img.ai_confidence >= 0.8 ? "high" : img.ai_confidence >= 0.5 ? "mid" : "low"}`}
                        title="AI 置信度">
                        {Math.round(img.ai_confidence * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* ---- 放大预览弹窗 ---- */}
      {preview && (
        <div className="preview-overlay" ref={overlayRef}
          onClick={e => { if (e.target === e.currentTarget) closePreview(); }}>
          <div className="preview-panel" onClick={e => e.stopPropagation()}>
            <div className="preview-header">
              <div className="preview-meta">
                <span className="preview-filename" title={preview.filename}>{preview.filename}</span>
                <span className="preview-tag">{preview.phase}</span>
                <span className="preview-tag">{preview.body_part ?? "未识别"}</span>
              </div>
              <div className="preview-header-actions">
                {preview.body_part?.startsWith("围度") && (
                  <span className="tape-edit">
                    <label>读数</label>
                    <input type="number" step={0.1} className="tape-input"
                      value={tapeValue(preview) ?? ""}
                      onChange={e => updateTape(preview.id, parseFloat(e.target.value) || null)}
                    />
                    <span className="tape-unit">cm</span>
                  </span>
                )}
                <button className="close-btn" onClick={closePreview}>✕</button>
              </div>
            </div>
            <div className="preview-stage">
              <img
                className={`preview-img ${dragging ? "dragging" : ""}`}
                src={`/api/image/${preview.id}`}
                alt={preview.filename}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                onMouseDown={handlePreviewMouseDown}
                onMouseMove={handlePreviewMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={endDrag}
                onDoubleClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                draggable={false}
              />
            </div>
            <div className="preview-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>← 上一张</button>
              <span className="preview-counter">{previewIdx + 1} / {images.length}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(1)}>下一张 →</button>
              <span className="preview-zoom">{Math.round(zoom * 100)}%</span>
              <button className="btn btn-secondary btn-sm" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
                重置
              </button>
              <span className="preview-hint">滚轮放大 · 拖拽平移 · 双击复位 · Esc 关闭</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
