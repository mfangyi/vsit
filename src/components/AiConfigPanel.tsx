// ============ AI 配置面板 ============
import { useState, useEffect, type FormEvent } from "react";
import { BASE_URL_PRESETS, MODEL_PRESETS, type AiConfig } from "../types";

interface Props {
  config: AiConfig | null;
  onSave: (config: AiConfig) => Promise<void>;
  onTest: (config: AiConfig) => Promise<{ ok: boolean; message: string }>;
  onDisconnect: () => Promise<void>;
  onClose: () => void;
}

export function AiConfigPanel({ config, onSave, onTest, onDisconnect, onClose }: Props) {
  const [baseUrl, setBaseUrl] = useState(config?.base_url ?? "");
  const [model, setModel] = useState(config?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [center, setCenter] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [assetVer, setAssetVer] = useState(0);
  const [overrideSaved, setOverrideSaved] = useState(false);
  const [wmMsg, setWmMsg] = useState("");

  // 加载全局水印默认
  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(s => { setCenter(s?.center ?? ""); setAddress(s?.address ?? ""); setPhone(s?.phone ?? ""); }).catch(() => {});
  }, []);

  const saveWatermark = async () => {
    setWmMsg("");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ center, address, phone, overrideSaved }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setWmMsg((data as { error?: string }).error ?? "保存失败"); return; }
    setWmMsg((data as { updated?: number }).updated ? `已保存并更新 ${data.updated} 个成品的水印` : "已保存，新的成品图将使用此水印");
  const uploadAsset = async (kind: "logo" | "qr", file: File) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("image", file);
    const res = await fetch("/api/assets", { method: "POST", body: fd });
    if (res.ok) setAssetVer(v => v + 1);
    else alert((await res.json().catch(() => ({})))?.error ?? "上传失败");
  };

  const resetAsset = async (kind: "logo" | "qr") => {
    await fetch(`/api/assets/${kind}`, { method: "DELETE" });
    setAssetVer(v => v + 1);
  };
    window.dispatchEvent(new Event("vsit-center-changed"));
  };

  const uploadAsset = async (kind: "logo" | "qr", file: File) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("image", file);
    const res = await fetch("/api/assets", { method: "POST", body: fd });
    if (res.ok) setAssetVer(v => v + 1);
    else alert((await res.json().catch(() => ({})))?.error ?? "上传失败");
  };

  const resetAsset = async (kind: "logo" | "qr") => {
    await fetch(`/api/assets/${kind}`, { method: "DELETE" });
    setAssetVer(v => v + 1);
  };
  const [error, setError] = useState("");

  const current: AiConfig = { base_url: baseUrl, model, api_key: apiKey || config?.api_key || "" };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await onTest(current);
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!baseUrl || !model || !apiKey) {
      setError("所有字段均为必填");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({ base_url: baseUrl, model, api_key: apiKey });
      onClose();
    } catch {
      setError("保存失败");
    }
    setSaving(false);
  };

  const handleDisconnect = async () => {
    await onDisconnect();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>AI 与全局设置</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>Base URL</label>
            <div className="input-row">
              <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://..." className="text-input" />
            </div>
            <div className="preset-row">
              {BASE_URL_PRESETS.map(url => (
                <button key={url} type="button" className="preset-btn"
                  onClick={() => setBaseUrl(url)} title={url}>
                  {url.includes("aliyun") ? "阿里云" : "腾讯"} ▸
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Model</label>
            <input type="text" value={model} onChange={e => setModel(e.target.value)}
              placeholder="模型名称" className="text-input" />
            <div className="preset-row">
              {MODEL_PRESETS.map(m => (
                <button key={m} type="button" className="preset-btn"
                  onClick={() => setModel(m)}>
                  {m} ▸
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>API Key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder={config ? "已配置（输入新值覆盖）" : "请输入 API Key"} className="text-input" />
          </div>
          {error && <div className="error-msg">{error}</div>}
          {testResult && (
            <div className={testResult.ok ? "success-msg" : "error-msg"}>
              {testResult.ok ? "✓ " : "✗ "}{testResult.message}
            </div>
          )}
          <div className="form-group" style={{ marginTop: 4 }}>
            <label>中央水印默认文字</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" value={center} onChange={e => setCenter(e.target.value)} className="text-input" />
              <button type="button" className="btn btn-secondary" onClick={saveWatermark} disabled={!center.trim()}>保存</button>
            </div>
            <label className="export-opt" style={{ color: "var(--text-2)", marginTop: 8 }}>
              <input type="checkbox" checked={overrideSaved} onChange={e => setOverrideSaved(e.target.checked)} />
              覆盖所有已保存布局的中央水印
            </label>
            <label style={{ display: "block", marginTop: 12 }}>海报页脚 · 门店地址（留空则不显示）</label>
            <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="text-input" placeholder="如：人和莱茵鹭湖F号楼超市商场3楼367号商铺" />
            <label style={{ display: "block", marginTop: 12 }}>海报页脚 · 联系电话</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="text-input" placeholder="如：16607715619" />
            <label style={{ display: "block", marginTop: 14 }}>海报品牌素材（点击图框可上传替换，存于本机）</label>
            <div className="asset-row">
              <div className="asset-cell">
                <img className="asset-thumb" alt="Logo" src={`/api/assets/logo?v=${assetVer}`}
                  onClick={() => document.getElementById("asset-logo-file")?.click()} />
                <div className="asset-actions">
                  <span>Logo</span>
                  <button type="button" className="asset-reset" onClick={() => resetAsset("logo")}>默认</button>
                </div>
                <input id="asset-logo-file" type="file" accept="image/*" hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAsset("logo", f); e.target.value = ""; }} />
              </div>
              <div className="asset-cell">
                <img className="asset-thumb" alt="二维码" src={`/api/assets/qr?v=${assetVer}`}
                  onClick={() => document.getElementById("asset-qr-file")?.click()} />
                <div className="asset-actions">
                  <span>二维码</span>
                  <button type="button" className="asset-reset" onClick={() => resetAsset("qr")}>默认</button>
                </div>
                <input id="asset-qr-file" type="file" accept="image/*" hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAsset("qr", f); e.target.value = ""; }} />
              </div>
            </div>
            {wmMsg && <div className="success-msg" style={{ marginBottom: 0, marginTop: 8 }}>{wmMsg}</div>}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={handleTest} disabled={testing}>
              {testing ? "测试中..." : "测试连接"}
            </button>
            {config && (
              <button type="button" className="btn btn-danger" onClick={handleDisconnect}>
                断开连接
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
