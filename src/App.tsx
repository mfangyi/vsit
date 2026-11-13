// ============ VSIT 主应用 ============
import { useState, useEffect, useCallback, useRef } from "react";
import "./index.css";
import { MemberPanel, type MemberInfo } from "./components/MemberPanel";
import { CompositionGrid } from "./components/CompositionGrid";
import { CanvasEditor } from "./components/CanvasEditor";
import { AiConfigPanel } from "./components/AiConfigPanel";
import { ImageClassifier } from "./components/ImageClassifier";
import { COMPOSITIONS, compositionSlots, defaultWatermark, parseLayout, setCenterDefault, type ImageTransform, type LayoutData } from "./types";
import { drawComposition } from "./render";
import { renderPoster, buildTapeRows, POSTER_ORDER, type PosterComp } from "./poster";
import type { AiConfig, CompositionDef, ImageRecord } from "./types";

type MainView = "compositions" | "classifier";

export function App() {
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [editing, setEditing] = useState<CompositionDef | null>(null);
  const [view, setView] = useState<MainView>("compositions");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [scanCurrentMember, setScanCurrentMember] = useState("");
  const [scanProcessing, setScanProcessing] = useState(0);
  const [scanStage, setScanStage] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMembers = useCallback(() => {
    return fetch("/api/members").then(r => r.json()).then(setMembers).catch(console.error);
  }, []);

  useEffect(() => {
    fetchMembers();
    fetch("/api/settings").then(r => r.json()).then(s => { if (s?.center) setCenterDefault(s.center); }).catch(() => {});
    fetch("/api/config").then(r => r.json()).then(data => {
      if (data && data.base_url) setAiConfig(data as AiConfig);
    }).catch(console.error);
  }, [fetchMembers]);

  const fetchImages = useCallback(async (name: string) => {
    const res = await fetch(`/api/members/${encodeURIComponent(name)}/images`);
    setImages(await res.json());
  }, []);

  const selectMember = useCallback((name: string) => {
    setSelectedMember(name);
    setEditing(null);
    fetchImages(name);
  }, [fetchImages]);

  // AI 扫描：服务端后台运行（全部会员），前端轮询进度 + 会员状态标签
  const handleScanAll = useCallback(async () => {
    if (!aiConfig || members.length === 0) return;
    setScanning(true);
    setScanProgress({ done: 0, total: 0 });

    try {
      const res = await fetch("/api/scan/all", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "扫描启动失败");
      }

      await new Promise<void>((resolve, reject) => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const s = await (await fetch("/api/scan/status")).json();
            setScanProgress({ done: s.done, total: s.total });
            setScanStage(s.stage ?? "");
            setScanCurrentMember(s.currentMember ?? "");
            setScanProcessing(s.processing ?? 0);
            // 同步刷新会员状态标签
            fetchMembers();
            // 实时刷新当前会员的识别列表
            if (selectedMember) fetchImages(selectedMember);
            if (!s.running) {
              if (pollRef.current) clearInterval(pollRef.current);
              resolve();
            }
          } catch (e) { reject(e); }
        }, 2500);
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "扫描失败");
    }

    try {
      const fin = await (await fetch("/api/scan/status")).json();
      const parts: string[] = [`成功 ${fin.okCount ?? 0}`];
      if ((fin.failCount ?? 0) > 0) parts.push(`跳过 ${fin.failCount}`);
      const tapeTotal = (fin.tapeOk ?? 0) + (fin.tapeFail ?? 0);
      if (tapeTotal > 0) parts.push(`围度读数 ${fin.tapeOk}/${tapeTotal}`);
      alert(`识别完成：${parts.join(" · ")}${(fin.failCount ?? 0) > 0 ? "。可再点一次「AI 识别」重试失败项" : ""}`);
    } catch { /* ignore */ }

    setScanning(false);
    setScanProgress(null);
    setScanStage("");
    setScanCurrentMember("");
    setScanProcessing(0);
    if (selectedMember) fetchImages(selectedMember);
  }, [aiConfig, members.length, selectedMember, fetchImages, fetchMembers]);


  const handleUpdateImage = useCallback(async (id: number, fields: Record<string, unknown>) => {
    await fetch(`/api/images/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (selectedMember) fetchImages(selectedMember);
  }, [selectedMember, fetchImages]);

  const handleSaveConfig = useCallback(async (config: AiConfig) => {
    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error("Save failed");
    setAiConfig(config);
  }, []);

  const handleTestConfig = useCallback(async (config: AiConfig) => {
    const res = await fetch("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return res.json() as Promise<{ ok: boolean; message: string }>;
  }, []);

  const handleDisconnect = useCallback(async () => {
    await fetch("/api/config", { method: "DELETE" });
    setAiConfig(null);
  }, []);

  const handleClearData = useCallback(async () => {
    if (!confirm("确定要清空全部缓存吗？将删除 SQLite 中的识别结果、AI 配置以及压缩图缓存，此操作不可撤销。")) return;
    await fetch("/api/data", { method: "DELETE" });
    setMembers([]);
    setImages([]);
    setSelectedMember(null);
    setAiConfig(null);
    fetchMembers();
  }, []);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [skipExported, setSkipExported] = useState(false);
  const [exportAllProgress, setExportAllProgress] = useState<{ member: string; done: number; total: number } | null>(null);
  const [posterBusy, setPosterBusy] = useState(false);
  const [posterProgress, setPosterProgress] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [posterPath, setPosterPath] = useState("");

  // 单会员导出：按识别结果 + 已保存布局/水印 拼合该会员全部成品图（与编辑器/卡片预览同一渲染）
  const exportMemberCompositions = useCallback(async (memberName: string, skip: boolean): Promise<{ ok: number; skipped: number }> => {
    const res = await fetch(`/api/members/${encodeURIComponent(memberName)}/images`);
    const imgs: ImageRecord[] = await res.json();
    // 拉取已保存布局（含水印）
    const layoutMap = new Map<string, LayoutData>();
    const exportedSet = new Set<string>();
    try {
      const lres = await fetch(`/api/compositions/${encodeURIComponent(memberName)}`);
      const ldata = await lres.json();
      for (const item of ldata.items ?? []) {
        if (item.exported === 1) exportedSet.add(item.body_part);
        if (!item.layout) continue;
        const parsed = parseLayout(item.layout, undefined, item.body_part);
        if (parsed) layoutMap.set(item.body_part, parsed);
      }
    } catch { /* 无布局，用 crop 字段 */ }

    let ok = 0;
    for (const def of COMPOSITIONS) {
      const records: ImageRecord[] = [];
      let missing = false;
      for (const part of def.inputParts) {
        const before = imgs.find(i => i.phase === "训练前" && i.body_part === part) ?? null;
        const after = imgs.find(i => i.phase === "训练后" && i.body_part === part) ?? null;
        if (!before || !after) { missing = true; break; }
        records.push(before, after);
      }
      if (missing) continue;
      if (skip && exportedSet.has(def.outputName)) continue;
      const els = await Promise.all(records.map(r => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`图片加载失败: ${r.filename}`));
        img.src = `/api/image/${r.id}`;
      })));
      const ld = layoutMap.get(def.outputName);
      const transforms: ImageTransform[] = records.map((r, i) =>
        ld?.transforms[i] ?? {
          zoom: r.crop_scale > 0 ? r.crop_scale : 1,
          cx: r.crop_x ?? 0.5,
          cy: r.crop_y ?? 0.5,
          rotation: r.crop_rotation ?? 0,
        });
      const watermark = ld?.watermark ?? defaultWatermark(def.outputName);

      const maxH = Math.max(...els.map(im => im.naturalHeight), 1000);
      const cropH = maxH;
      const cropW = Math.round(cropH * (2 / 3));
      const canvas = document.createElement("canvas");
      canvas.width = cropW * 2;
      canvas.height = def.isGrid ? cropH * 2 : cropH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 不可用");
      drawComposition(ctx, {
        slots: els.map((img, i) => ({ img, transform: transforms[i]! })),
        isGrid: def.isGrid,
        cropW, cropH,
        watermark,
        readings: records.map(r => r.tape_reading ?? null),
      });
      const blob = await new Promise<Blob | null>(bRes => canvas.toBlob(bRes, "image/jpeg", 0.92));
      if (!blob) throw new Error(`${def.outputName} 生成失败`);
      const fd = new FormData();
      fd.append("member", memberName);
      fd.append("body_part", def.outputName);
      fd.append("image", blob, `${def.outputName}.jpg`);
      const exRes = await fetch("/api/export", { method: "POST", body: fd });
      if (!exRes.ok) throw new Error(`${def.outputName} 导出失败`);
      ok++;
    }
    return { ok, skipped: COMPOSITIONS.length - ok };
  }, []);

  const handleScanStop = useCallback(async () => {
    try { await fetch("/api/scan/stop", { method: "POST" }); } catch { /* ignore */ }
  }, []);

  const handleAddMember = useCallback(async () => {
    const name = window.prompt("新会员姓名")?.trim();
    if (!name) return;
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert((data as { error?: string }).error ?? "创建失败"); return; }
    await fetchMembers();
    selectMember(name);
    alert(`已创建会员「${name}」\n请把照片放入 桌面\vsit\原始图\${name}\训练前 · 训练后，放好后点「AI 识别全部会员」`);
  }, [fetchMembers, selectMember]);

  // 侧边栏：导出全部会员成品图
  const handleExportAllMembers = useCallback(async () => {
    if (exportingAll || members.length === 0) return;
    if (!confirm(`将按当前识别结果与保存布局，导出全部 ${members.length} 位会员的成品图到各自 成品图 目录，继续？`)) return;
    setExportingAll(true);
    let okTotal = 0;
    const skippedNotes: string[] = [];
    try {
      for (let i = 0; i < members.length; i++) {
        const m = members[i]!;
        setExportAllProgress({ member: m.name, done: i, total: members.length });
        const r = await exportMemberCompositions(m.name, skipExported);
        okTotal += r.ok;
        if (r.skipped > 0) skippedNotes.push(`${m.name}（${r.skipped} 张缺图）`);
      }
      alert(`已导出 ${okTotal} 张成品图至各会员 成品图\\ 目录${skippedNotes.length ? `；因缺图跳过：${skippedNotes.join("、")}` : ""}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "导出失败");
    }
    setExportingAll(false);
    setExportAllProgress(null);
  }, [exportingAll, members, skipExported, exportMemberCompositions]);

  // 会员页：导出当前选中会员
  const handleExportCurrent = useCallback(async () => {
    if (!selectedMember || exporting) return;
    if (!confirm(`将根据当前识别结果拼合 ${selectedMember} 的全部成品图，直接写入 成品图\\${selectedMember}\\ 目录，继续？`)) return;
    setExporting(true);
    setExportProgress({ done: 0, total: COMPOSITIONS.length });
    try {
      const r = await exportMemberCompositions(selectedMember, skipExported);
      alert(r.skipped > 0
        ? `已导出 ${r.ok} 张至 成品图\\${selectedMember}\\ 目录（${r.skipped} 张因缺图跳过）`
        : `全部 ${r.ok} 张成品图已写入 成品图\\${selectedMember}\\ 目录`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "导出失败");
    }
    setExporting(false);
    setExportProgress(null);
  }, [selectedMember, exporting, skipExported, exportMemberCompositions]);
  // 长图海报
  const loadBrandImg = (url: string) => new Promise<HTMLImageElement | null>((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });

  const handlePoster = useCallback(async () => {
    if (!selectedMember || posterBusy) return;
    setPosterBusy(true);
    try {
      const res = await fetch(`/api/members/${encodeURIComponent(selectedMember)}/images`);
      const imgs: ImageRecord[] = await res.json();
      setImages(imgs);

      const layoutMap = new Map<string, LayoutData>();
      try {
        const ldata = await (await fetch(`/api/compositions/${encodeURIComponent(selectedMember)}`)).json();
        for (const item of ldata.items ?? []) {
          const parsed = parseLayout(item.layout, undefined, item.body_part);
          if (parsed) layoutMap.set(item.body_part, parsed);
        }
      } catch { /* 无布局 */ }

      const settings = await (await fetch("/api/settings")).json();
      const [logoImg, qrImg] = await Promise.all([loadBrandImg("/api/assets/logo"), loadBrandImg("/api/assets/qr")]);

      const byName = new Map(COMPOSITIONS.map(x => [x.outputName, x]));
      const order = POSTER_ORDER.map(n => byName.get(n)).filter((x): x is (typeof COMPOSITIONS)[number] => !!x);
      for (const x of COMPOSITIONS) if (!POSTER_ORDER.includes(x.outputName)) order.push(x);
      const readyCount = order.filter(d => compositionSlots(d, imgs).every(s => s !== null)).length;
      const comps: PosterComp[] = [];
      let n = 0;
      for (const def of order) {
        const slotRecs = compositionSlots(def, imgs);
        if (!slotRecs.every(s => s !== null)) continue;
        setPosterProgress(`加载图片 ${++n}/${readyCount}`);
        const els = await Promise.all(slotRecs.map(r => new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image();
          im.onload = () => resolve(im);
          im.onerror = () => reject(new Error(`图片加载失败: ${r!.filename}`));
          im.src = `/api/image/${r!.id}/thumb`;
        })));
        const ld = layoutMap.get(def.outputName);
        const transforms: ImageTransform[] = slotRecs.map((r, i) =>
          ld?.transforms[i] ?? {
            zoom: r!.crop_scale > 0 ? r!.crop_scale : 1,
            cx: r!.crop_x ?? 0.5,
            cy: r!.crop_y ?? 0.5,
            rotation: r!.crop_rotation ?? 0,
          });
        comps.push({
          def,
          slots: els.map((img, i) => ({ img, transform: transforms[i]! })),
          watermark: ld?.watermark ?? defaultWatermark(def.outputName),
          readings: slotRecs.map(r => r!.tape_reading ?? null),
          isGrid: def.isGrid,
        });
      }
      if (comps.length === 0) throw new Error("没有已就绪的成品图，请先完成 AI 识别");

      setPosterProgress("排版绘制中…");
      const d = new Date();
      const pad = (x: number) => String(x).padStart(2, "0");
      const canvas = await renderPoster({
        member: selectedMember,
        dateText: `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`,
        address: settings.address ?? "",
        phone: settings.phone ?? "",
        logo: logoImg,
        qr: qrImg,
        comps,
        tapeRows: buildTapeRows(imgs),
      });
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("画布导出失败");

      const fd = new FormData();
      fd.append("member", selectedMember);
      fd.append("image", blob, "poster.png");
      const saved = await (await fetch("/api/poster", { method: "POST", body: fd })).json();
      if (posterUrl) URL.revokeObjectURL(posterUrl);
      setPosterUrl(URL.createObjectURL(blob));
      setPosterPath(saved.filepath ?? "");
    } catch (e) {
      alert(`海报生成失败：${e instanceof Error ? e.message : String(e)}`);
    }
    setPosterBusy(false);
    setPosterProgress("");
  }, [selectedMember, posterBusy, posterUrl]);

  const handleExport = useCallback(async (formData: FormData) => {

    const res = await fetch("/api/export", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Export failed");
    await res.json();
  }, []);

  return (
    <div className="app">
      <MemberPanel
        members={members}
        selected={selectedMember}
        onSelect={selectMember}
        aiConnected={!!aiConfig}
        onOpenConfig={() => setShowConfig(true)}
        onClearData={handleClearData}
        images={images}
        onScanAll={handleScanAll}
        scanning={scanning}
        scanProgress={scanProgress}
        onExportAllMembers={handleExportAllMembers}
        exportingAll={exportingAll}
        exportAllProgress={exportAllProgress}
        scanStage={scanStage}
        scanCurrentMember={scanCurrentMember}
        scanProcessing={scanProcessing}
        onScanStop={handleScanStop}
        onAddMember={handleAddMember}
        skipExported={skipExported}
        onToggleSkipExported={setSkipExported}
      />
      <main className="main-content">
        {selectedMember && editing ? (
          <CanvasEditor
            def={editing}
            images={images}
            member={selectedMember}
            onClose={() => setEditing(null)}
            onUpdateImage={handleUpdateImage}
            onExport={handleExport}
          />
        ) : selectedMember ? (
          <>
            <div className="view-toggle-row"><div className="view-toggle">
              <button className={`toggle-btn ${view === "compositions" ? "active" : ""}`}
                onClick={() => setView("compositions")}>成品图</button>
              <button className={`toggle-btn ${view === "classifier" ? "active" : ""}`}
                onClick={() => setView("classifier")}>识别列表</button>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-secondary" onClick={handlePoster} disabled={posterBusy}>
                  {posterBusy ? (posterProgress || "海报生成中…") : "📱 长图海报"}
                </button>
                <button className="btn btn-primary" onClick={handleExportCurrent} disabled={exporting}>
                {exporting && exportProgress ? `导出中 ${exportProgress.done}/${exportProgress.total}…` : "⬇ 导出当前会员成品图"}
                </button>
              </div>
            </div>
            {view === "compositions" ? (
              <CompositionGrid images={images} member={selectedMember} onEdit={setEditing} />
            ) : (
              <ImageClassifier images={images} onUpdate={handleUpdateImage} />
            )}
          </>
        ) : (
          <div className="placeholder">
            <div className="placeholder-icon">📸</div>
            <h2>请从左侧选择会员</h2>
            <p>数据目录：Desktop\vsit\原始图\{'{会员姓名}'}\训练前 · 训练后</p>
          </div>
        )}
      </main>
      {posterUrl && (
        <div className="preview-overlay" onClick={() => setPosterUrl("")}>
          <div className="poster-panel" onClick={e => e.stopPropagation()}>
            <div className="preview-header">
              <div className="preview-meta"><span className="preview-filename">长图海报 · {selectedMember}</span></div>
              <button className="close-btn" onClick={() => setPosterUrl("")}>✕</button>
            </div>
            <div className="poster-scroll"><img src={posterUrl} alt="长图海报" /></div>
            <div className="preview-footer"><span className="preview-hint" style={{ marginLeft: 0 }}>已保存：{posterPath}</span></div>
          </div>
        </div>
      )}
      {showConfig && (
        <AiConfigPanel
          config={aiConfig}
          onSave={handleSaveConfig}
          onTest={handleTestConfig}
          onDisconnect={handleDisconnect}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}
