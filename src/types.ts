// ============ VSIT 共享类型定义 ============

/** AI 识别的 19 个身体部位分类 */
export const BODY_PARTS = [
  "体态-全身-正面垂手", "体态-全身-正面抬手",
  "体态-全身-背面垂手", "体态-全身-背面抬手",
  "体态-全身-左面垂手", "体态-全身-左面抬手",
  "体态-全身-右面垂手", "体态-全身-右面抬手",
  "体态-背部", "体态-背部上肢-左", "体态-背部上肢-右",
  "围度-大腿-左", "围度-大腿-右",
  "围度-肋骨", "围度-上腹", "围度-中腹", "围度-下腹",
  "围度-手臂-左", "围度-手臂-右",
] as const;

export type BodyPart = (typeof BODY_PARTS)[number];

/** 需要读取软尺刻度的部位 */
export const TAPE_PARTS: readonly string[] = BODY_PARTS.filter(p => p.startsWith("围度"));

/** 成品图拼合定义（17 张输出 ← 19 项分类） */
export interface CompositionDef {
  outputName: string;
  inputParts: readonly string[]; // 1 = side-by-side, 2 = grid-2x2
  isGrid: boolean;
}

export const COMPOSITIONS: CompositionDef[] = [
  { outputName: "体态-全身-正面垂手", inputParts: ["体态-全身-正面垂手"], isGrid: false },
  { outputName: "体态-全身-正面抬手", inputParts: ["体态-全身-正面抬手"], isGrid: false },
  { outputName: "体态-全身-背面垂手", inputParts: ["体态-全身-背面垂手"], isGrid: false },
  { outputName: "体态-全身-背面抬手", inputParts: ["体态-全身-背面抬手"], isGrid: false },
  { outputName: "体态-全身-左面垂手", inputParts: ["体态-全身-左面垂手"], isGrid: false },
  { outputName: "体态-全身-左面抬手", inputParts: ["体态-全身-左面抬手"], isGrid: false },
  { outputName: "体态-全身-右面垂手", inputParts: ["体态-全身-右面垂手"], isGrid: false },
  { outputName: "体态-全身-右面抬手", inputParts: ["体态-全身-右面抬手"], isGrid: false },
  { outputName: "体态-背部",         inputParts: ["体态-背部"],         isGrid: false },
  { outputName: "体态-背部上肢-左",   inputParts: ["体态-背部上肢-左"],   isGrid: false },
  { outputName: "体态-背部上肢-右",   inputParts: ["体态-背部上肢-右"],   isGrid: false },
  { outputName: "围度-大腿",         inputParts: ["围度-大腿-左", "围度-大腿-右"], isGrid: true },
  { outputName: "围度-肋骨",         inputParts: ["围度-肋骨"],         isGrid: false },
  { outputName: "围度-上腹",         inputParts: ["围度-上腹"],         isGrid: false },
  { outputName: "围度-中腹",         inputParts: ["围度-中腹"],         isGrid: false },
  { outputName: "围度-下腹",         inputParts: ["围度-下腹"],         isGrid: false },
  { outputName: "围度-手臂",         inputParts: ["围度-手臂-左", "围度-手臂-右"], isGrid: true },
];

/** 图片记录（对应 images 表） */
export interface ImageRecord {
  id: number;
  member: string;
  phase: "训练前" | "训练后";
  filename: string;
  body_part: string | null;
  tape_reading: number | null;
  crop_x: number;
  crop_y: number;
  crop_scale: number;
  crop_rotation: number;
  ai_confidence: number | null;
  classified: number; // 0/1
}

/** Canvas 单图变换参数（归一化坐标） */
export interface ImageTransform {
  zoom: number;     // 1 = 适配裁剪区, >1 放大
  cx: number;       // 可见区域中心 x (0-1 of image width)
  cy: number;       // 可见区域中心 y (0-1 of image height)
  rotation: number; // 角度
}

export const DEFAULT_TRANSFORM: ImageTransform = { zoom: 1, cx: 0.5, cy: 0.5, rotation: 0 };

/** AI 配置 */
export interface AiConfig {
  base_url: string;
  model: string;
  api_key: string;
}

/** AI 识别结果 */
export interface ClassifyResult {
  body_part: string;
  tape_reading: number | null;
  confidence: number;
}

/** 快捷输入预设 */
export const BASE_URL_PRESETS = [
  "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  "https://tokenhub.tencentmaas.com/v1",
];

export const MODEL_PRESETS = ["qwen3.8-flash", "glm-5.3-flash"];

/** 成品图水印文字（微软雅黑，可在编辑器中修改） */
export interface WatermarkConfig {
  center: string; // 成品图中央半透明文字
  before: string; // 左图左上角红字
  after: string;  // 右图左上角红字
  title: string;  // 底部中央白色标题
}

export const DEFAULT_CENTER_TEXT = "静沐瑜伽|十天维密训练营";
export const DEFAULT_STORE_NAME = "静沐瑜伽·普拉提馆";
export const DEFAULT_POSTER_ADDRESS = "人和莱茵鹭湖F号楼超市商场3楼367号商铺";
export const DEFAULT_POSTER_PHONE = "16607715619";

/** 运行时可注入的全局默认（启动时从 app_settings 读取覆盖） */
export const appDefaults = { center: DEFAULT_CENTER_TEXT };
export function setCenterDefault(v: string | null): void {
  appDefaults.center = v && v.trim() ? v : DEFAULT_CENTER_TEXT;
}

/** 底部标题覆写表（按运营需求定制；未列出的槽位走默认规则） */
const TITLE_OVERRIDES: Record<string, string> = {
  "体态-全身-正面垂手": "全身体态",
  "体态-全身-正面抬手": "全身体态",
  "体态-全身-背面垂手": "全身体态",
  "体态-全身-背面抬手": "全身体态",
  "体态-全身-左面垂手": "全身体态",
  "体态-全身-左面抬手": "全身体态",
  "体态-全身-右面垂手": "全身体态",
  "体态-全身-右面抬手": "全身体态",
  "体态-背部": "背部",
  "体态-背部上肢-左": "背部上肢",
  "体态-背部上肢-右": "背部上肢",
};

/** 旧版默认标题（迁移用：已保存布局若匹配这些值，自动升级为新默认） */
const OLD_DEFAULT_TITLES = new Set([
  "体态-全身-正面", "体态-全身-背面", "体态-全身-左面", "体态-全身-右面",
  "体态-背部", "体态-背部上肢", "大腿围度", "肋骨围度", "上腹围度",
  "中腹围度", "下腹围度", "手臂围度",
]);

/** 成品图文件名 → 底部标题 */
export function compositionLabel(outputName: string): string {
  const override = TITLE_OVERRIDES[outputName];
  if (override) return override;
  const m = outputName.match(/^围度-(.+)$/);
  if (m) return `${m[1]}围度`;
  return outputName.replace(/-(?:垂手|抬手|左|右)$/, "");
}

export function defaultWatermark(outputName: string): WatermarkConfig {
  return { center: appDefaults.center, before: "前", after: "后", title: compositionLabel(outputName) };
}

/** 布局 JSON（v2：对象含 transforms + watermark；v1：纯 transforms 数组） */
export interface LayoutData {
  transforms: ImageTransform[];
  watermark: WatermarkConfig;
}

export function parseLayout(raw: string | null | undefined, slotCount?: number, outputName?: string): LayoutData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      if (slotCount !== undefined && parsed.length !== slotCount) return null;
      return {
        transforms: parsed as ImageTransform[],
        watermark: defaultWatermark(outputName ?? ""),
      };
    }
    const obj = parsed as { transforms?: unknown; watermark?: Partial<WatermarkConfig> };
    if (obj && Array.isArray(obj.transforms) && (slotCount === undefined || obj.transforms.length === slotCount)) {
      return {
        transforms: obj.transforms as ImageTransform[],
        watermark: (() => {
          const base = { ...defaultWatermark(outputName ?? ""), ...obj.watermark };
          // 旧默认标题自动迁移为新默认（用户自定义的标题不受影响）
          if (outputName && OLD_DEFAULT_TITLES.has(base.title)) {
            base.title = compositionLabel(outputName);
          }
          return base;
        })(),
      };
    }
  } catch { /* ignore */ }
  return null;
}

/** 某成品图是否素材齐备（每部位前+后都在且已分类） */
export function compositionSlots(def: CompositionDef, images: ImageRecord[]): (ImageRecord | null)[] {
  const slots: (ImageRecord | null)[] = [];
  for (const part of def.inputParts) {
    slots.push(images.find(i => i.phase === "训练前" && i.body_part === part) ?? null);
    slots.push(images.find(i => i.phase === "训练后" && i.body_part === part) ?? null);
  }
  return slots;
}

export function compositionReady(def: CompositionDef, images: ImageRecord[]): boolean {
  return compositionSlots(def, images).every(s => s !== null);
}