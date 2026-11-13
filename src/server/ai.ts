// ============ AI 识别代理模块（分类与读数分离 + 统一 60s 超时） ============
import type { AiConfig, ClassifyResult } from "../types";
import { BODY_PARTS } from "../types";

const AI_TIMEOUT_MS = 60_000;

/** 分类专用 Prompt（不含读数任务） */
const CLASSIFY_PROMPT = `你是体态评估照片的分类助手。照片分为三大类：全身体态照、背部照、围度测量照（有软尺）。请按步骤判断：

第一步 区分类型：
A. 能看到整个人（从头到脚）→ 全身体态照，进入第二步
B. 只显示局部（无头或无脚）→ 进入第三步

第二步 全身照分类：
朝向判断：
- 正面：可见面部和身体前面
- 背面：可见后脑勺、辫子和背部
- 侧面：侧身站立。人物面部朝向画面右侧 → 左面；面部朝向画面左侧 → 右面
手臂姿态：
- 垂手：双臂自然下垂贴于身体两侧
- 抬手：双臂屈肘抬起（抱于胸前或前平举），不是向上高举
输出：体态-全身-{朝向}-{垂手或抬手}，如"体态-全身-正面垂手"

第三步 局部照分类：
- 有软尺（细长带刻度的测量尺，通常为蓝色）→ 围度测量照，进入第四步
- 无软尺 → 背部照：
  - 背面视角，脊柱居中、头基本端正、双臂自然下垂 → 体态-背部
  - 背面视角，头部明显偏向一侧、主要展示一侧肩部和手臂 → 体态-背部上肢-左 或 -右
    （判断规则：头部/脸偏向画面哪一侧，就判哪一侧。头部偏向画面左侧 → 体态-背部上肢-左；偏向画面右侧 → 体态-背部上肢-右）

第四步 围度测量照，判断软尺缠绕位置：
- 画面主体是腿部（大腿特写）→ 围度-大腿-左 或 围度-大腿-右
- 画面主体是上臂（手臂特写）→ 围度-手臂-左 或 围度-手臂-右
- 软尺绕在躯干上（以肚脐为参照，肚脐通常清晰可见）：
  - 软尺位于胸部正下方（肋弓下缘，明显较高）→ 围度-肋骨
  - 软尺在肚脐上方（肋骨与肚脐之间）→ 围度-上腹
  - 软尺平齐或穿过肚脐 → 围度-中腹
  - 软尺在肚脐下方（下腹部）→ 围度-下腹

左右肢体判断（适用于大腿/手臂/背部上肢）：
- 从背面拍摄：画面左侧是人物左侧，画面右侧是人物右侧
- 从正面拍摄：画面左侧是人物右侧，画面右侧是人物左侧
- 参考线索：辫子垂向哪侧、头部转向哪侧、双腿的相对位置
- 若确实无法确定，默认输出"左"并在 confidence 中反映不确定度

只做分类，不要读软尺上的数字。
重要：不要分步骤输出分析过程，跳过所有解释，直接输出最终答案。最终只输出一个JSON对象，不要输出任何其他文字：
{"body_part": "19个分类之一的准确文本", "confidence": 0到1的小数}`;

/** 分类降级 Prompt（极简） */
const FALLBACK_PROMPT = `判断这张体态评估照片属于以下哪个分类：
体态-全身-正面垂手、体态-全身-正面抬手、体态-全身-背面垂手、体态-全身-背面抬手、
体态-全身-左面垂手、体态-全身-左面抬手、体态-全身-右面垂手、体态-全身-右面抬手、
体态-背部、体态-背部上肢-左、体态-背部上肢-右、
围度-大腿-左、围度-大腿-右、围度-肋骨、围度-上腹、围度-中腹、围度-下腹、围度-手臂-左、围度-手臂-右

侧面照：人物面部朝向画面右侧=左面，朝向画面左侧=右面。
有软尺的照片：软尺在大腿=大腿，在上臂=手臂，在躯干按肚脐位置分（胸下=肋骨、脐上=上腹、平脐=中腹、脐下=下腹）。

直接输出JSON，不要任何解释：
{"body_part": "分类名", "confidence": 0到1}`;

/** 读数专用 Prompt（只读软尺数字） */
const TAPE_PROMPT = `这是一张围度测量照片（软尺绕在身体某部位）。请仔细辨认软尺刻度交汇重叠处的数字，读出围度值（单位cm，精确到0.1）。若数字模糊无法辨认输出null。
直接输出JSON，不要任何解释：{"tape_reading": 数字或null}`;

function extractJson(text: string): ClassifyResult | null {
  const cleaned = text.replace(/```json?\s*/g, "").replace(/```/g, "");
  // 模型可能先输出推理文本（内含模板JSON），最终答案在最后 —— 从最后一个候选向前解析
  const matches = [...cleaned.matchAll(/\{[^{}]*\}/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(matches[i]![0]);
      if (typeof obj.body_part === "string" && (BODY_PARTS as readonly string[]).includes(obj.body_part)) {
        const confidence = typeof obj.confidence === "number" ? obj.confidence : parseFloat(obj.confidence) || 0.5;
        // 分类调用不读软尺，tape_reading 由独立的 readTape 阶段负责
        return { body_part: obj.body_part, tape_reading: null, confidence };
      }
    } catch { continue; }
  }
  return null;
}

async function callAi(base64Image: string, config: AiConfig, prompt: string): Promise<string> {
  const dataUrl = base64Image.startsWith("data:")
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  const res = await fetch(`${config.base_url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`AI API returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
  };
  const msg = data.choices?.[0]?.message;
  // content 为空时回退到 reasoning_content（思考型模型可能把答案写在思考字段）
  const text = (msg?.content ?? "").trim() || (msg?.reasoning_content ?? "").trim();
  return text;
}

/** 分类（3 次尝试：完整 → 极简 → 极简；超时直接跳过该图） */
export async function classifyWithAi(base64Image: string, config: AiConfig): Promise<ClassifyResult> {
  let lastErr = "AI returned empty response";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = attempt === 1 ? CLASSIFY_PROMPT : FALLBACK_PROMPT;
    let text: string;
    try {
      text = await callAi(base64Image, config, prompt);
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw new Error("识别超时，已跳过该图片");
      }
      lastErr = e instanceof Error ? e.message : String(e);
      continue;
    }
    const result = extractJson(text);
    if (result) return result;
    lastErr = text ? `Failed to parse AI response: ${text.slice(0, 150)}` : "AI returned empty response";
  }
  throw new Error(lastErr);
}

/** 读数专用（2 次尝试，每次 60s；失败返回 null 留待人工） */
export async function readTape(base64Image: string, config: AiConfig): Promise<number | null> {
  const dataUrl = base64Image.startsWith("data:")
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${config.base_url}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.api_key}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: [
            { type: "text", text: TAPE_PROMPT },
            { type: "image_url", image_url: { url: dataUrl } },
          ]}],
          max_tokens: 4096,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
      };
      const msg = data.choices?.[0]?.message;
      const text = (msg?.content ?? "").trim() || (msg?.reasoning_content ?? "").trim();
      const cleaned = text.replace(/```json?\s*/g, "").replace(/```/g, "");
      const matches = [...cleaned.matchAll(/\{[^{}]*\}/g)];
      for (let i = matches.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(matches[i]![0]);
          let v = obj.tape_reading;
          if (v === null || v === undefined || v === "") continue;
          if (typeof v === "string") v = parseFloat(v);
          if (typeof v === "number" && !isNaN(v)) return v;
        } catch { continue; }
      }
      // 模型明确返回 null 或无法解析 —— 重试一次
    } catch (e) {
      // 超时或其他网络错误 —— 重试一次
      if (attempt >= 2) return null;
      continue;
    }
  }
  return null;
}

export async function testAiConnection(config: AiConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${config.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.api_key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
    });
    if (res.ok) return { ok: true, message: "连接成功" };
    const body = await res.text();
    return { ok: false, message: `HTTP ${res.status}: ${body.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "连接失败" };
  }
}

/** 单张受限分类：从给定候选分类中选择（用于剩余图片补位） */
export async function assignSingle(
  base64Image: string,
  labels: string[],
  config: AiConfig,
): Promise<string | null> {
  const prompt = `这是一张体态评估照片。它属于以下哪个分类（只能从中选一个）：
${labels.join("、")}

提示：有软尺则按软尺位置判断（大腿=腿、手臂=上臂、躯干按肚脐位置分：胸下=肋骨、脐上=上腹、平脐=中腹、脐下=下腹）。
直接输出JSON，不要任何解释：{"body_part": "分类名", "confidence": 0到1}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${config.base_url}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.api_key}` },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: base64Image.startsWith("data:") ? base64Image : `data:image/jpeg;base64,${base64Image}` } },
          ]}],
          max_tokens: 4096, temperature: 0.1,
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = await res.json() as { choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[] };
      const msg = data.choices?.[0]?.message;
      const text = (msg?.content ?? "").trim() || (msg?.reasoning_content ?? "").trim();
      const cleaned = text.replace(/```json?\s*/g, "").replace(/```/g, "");
      const matches = [...cleaned.matchAll(/\{[^{}]*\}/g)];
      for (let i = matches.length - 1; i >= 0; i--) {
        try {
          const obj = JSON.parse(matches[i]![0]);
          if (typeof obj.body_part === "string" && labels.includes(obj.body_part)) {
            return obj.body_part;
          }
        } catch { continue; }
      }
    } catch { continue; }
  }
  return null;
}
