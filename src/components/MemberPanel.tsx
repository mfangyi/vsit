// ============ 侧边栏（会员列表 + 全员识别 + 状态标签） ============
import { type ImageRecord } from "../types";

export interface MemberInfo {
  name: string;
  total: number;
  classified: number;
}

interface Props {
  members: MemberInfo[];
  selected: string | null;
  onSelect: (name: string) => void;
  aiConnected: boolean;
  onOpenConfig: () => void;
  onClearData: () => void;
  images: ImageRecord[];
  onScanAll: () => void;
  scanning: boolean;
  scanProgress: { done: number; total: number } | null;
  scanStage: string;
  scanCurrentMember: string;
  scanProcessing: number;
  onExportAllMembers: () => void;
  onScanStop: () => void;
  onAddMember: () => void;
  skipExported: boolean;
  onToggleSkipExported: (v: boolean) => void;
  exportingAll: boolean;
  exportAllProgress: { member: string; done: number; total: number } | null;
}

export function MemberPanel({ members, selected, onSelect, aiConnected, onOpenConfig, onClearData, images, onScanAll, scanning, scanProgress, scanStage, scanCurrentMember, scanProcessing, onExportAllMembers, onScanStop, onAddMember, skipExported, onToggleSkipExported, exportingAll, exportAllProgress }: Props) {
  const pct = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.done / scanProgress.total) * 100)
    : 0;
  const pendingTotal = members.reduce((s, m) => s + (m.total - m.classified), 0);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-badge">VS</div>
        <span className="logo-text">VSIT</span>
        <span className="logo-sub">Victoria's Secret Image Tool</span>
      </div>

      <div className="ai-status-bar" onClick={onOpenConfig}>
        <span className={`status-dot ${aiConnected ? "connected" : "disconnected"}`} />
        <span>{aiConnected ? "AI 已连接" : "AI 未连接"}</span>
        <span className="config-link">⚙ 配置</span>
      </div>

      <div className="member-actions">
        <button className="btn btn-primary btn-block" onClick={onScanAll}
          disabled={scanning || !aiConnected || members.length === 0}>
          {scanning
            ? `识别中 ${scanCurrentMember ? `· ${scanCurrentMember} ` : ""}${scanProgress && scanProgress.total > 0 ? `${scanProgress.done}/${scanProgress.total}` : "..."}`
            : pendingTotal > 0
              ? `AI 识别全部会员 (${pendingTotal} 张待识别)`
              : "重新识别全部会员"}
        </button>
        {scanning && scanProgress && (
          <>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="scan-progress-text">{pct}%{scanStage ? ` · ${scanStage}` : ""}{scanProcessing > 0 ? ` · 处理中 ${scanProcessing}` : ""}</div>
            <button className="btn btn-danger btn-sm btn-block scan-stop-btn" onClick={onScanStop}>■ 停止扫描</button>
          </>
        )}
      </div>

      <div className="member-section">
        <div className="section-title-row"><span>会员列表</span><button className="add-member-btn" title="新建会员" onClick={onAddMember}>＋</button></div>
        <div className="member-list">
          {members.length === 0 && <div className="empty-msg">暂无会员数据</div>}
          {members.map(m => {
            const done = m.total > 0 && m.classified >= m.total;
            return (
              <div key={m.name}
                className={`member-item ${selected === m.name ? "active" : ""}`}
                onClick={() => onSelect(m.name)}>
                <span className="member-name">{m.name}</span>
                <span className={`member-badge ${done ? "ok" : "partial"}`}>
                  {done ? "✓ 完成" : `${m.classified}/${m.total}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="member-actions">
        <button className="btn btn-secondary btn-block" onClick={onExportAllMembers} disabled={exportingAll || members.length === 0}>
          {exportingAll
            ? `导出中 ${exportAllProgress ? `${exportAllProgress.member} · ${exportAllProgress.done}/${exportAllProgress.total}` : "..."}`
            : "⬇ 一键导出全部会员成品图"}
        </button>
        <label className="export-opt"><input type="checkbox" checked={skipExported} onChange={e => onToggleSkipExported(e.target.checked)} /> 仅导出未导出的</label>
        {exportingAll && exportAllProgress && (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${(exportAllProgress.done / exportAllProgress.total) * 100}%` }} />
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="btn btn-danger btn-block" onClick={onClearData}>
          清空全部缓存
        </button>
      </div>
    </aside>
  );
}
