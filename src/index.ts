// ============ VSIT 服务端入口 ============
import { serve } from "bun";
import { existsSync } from "fs";
import index from "./index.html";
import {
  initDb, getAiConfig, saveAiConfig, deleteAiConfig,
  upsertImage, getImagesByMember, getImageById, updateImage,
  saveComposition, markExported, clearAllData, getCompositionLayout, getCompositionsByMember, getMemberStats,
  getSetting, setSetting, getAllCompositionLayouts, updateCompositionLayoutById,
} from "./server/db";
import { getMembers, scanMemberImages, getImageFilePath, exportImage, getThumbPath, saveThumb, clearThumbs, createMemberDirs, memberExists, savePoster, getAssetPath, saveAsset, deleteAsset } from "./server/fs";
import { classifyWithAi, testAiConnection, readTape } from "./server/ai";
import { EMBEDDED_LOGO, EMBEDDED_QR } from "./assets.embed";
import { BODY_PARTS, DEFAULT_CENTER_TEXT, DEFAULT_POSTER_ADDRESS, DEFAULT_POSTER_PHONE, compositionLabel, type ImageRecord } from "./types";

initDb();

/** 带路由参数的请求 */
type RouteReq = Request & { params: Record<string, string> };

function openInBrowser(url: string): void {
  // 使用系统默认浏览器打开
  Bun.spawn(["explorer.exe", url], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 文件响应 + ETag 协商缓存（304 省流量，内容变化立即失效） */
async function serveFileWithCache(req: RouteReq, filepath: string): Promise<Response> {
  if (!existsSync(filepath)) return json({ error: "File not found on disk" }, 404);
  const file = Bun.file(filepath);
  const size = file.size;
  const mtime = (await file.lastModified) || 0;
  const etag = `W/"${mtime.toString(36)}-${size.toString(36)}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { "ETag": etag, "Cache-Control": "no-cache" } });
  }
  return new Response(file, { headers: { "ETag": etag, "Cache-Control": "no-cache" } });
}

// ---------- 服务端压缩（Bun.Image） ----------
async function compressToThumb(record: ImageRecord): Promise<string> {
  const orig = getImageFilePath(record);
  const buf = await Bun.file(orig).image()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  saveThumb(record.id, buf);
  return `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;
}

async function getOrCompressThumbBase64(record: ImageRecord): Promise<string> {
  const cached = Bun.file(getThumbPath(record.id));
  if (cached.size > 0) {
    return `data:image/jpeg;base64,${Buffer.from(await cached.arrayBuffer()).toString("base64")}`;
  }
  return compressToThumb(record);
}

// ---------- 后台扫描编排 ----------
const scanState = {
  running: false, done: 0, total: 0, stage: "", processing: 0, stopping: false,
  currentMember: "", membersTotal: 0, membersDone: 0,
  okCount: 0, failCount: 0, tapeOk: 0, tapeFail: 0,
};


/** 处理单个会员：扫描目录 + 识别未分类（并发 10） */
async function processMember(member: string, config: NonNullable<Awaited<ReturnType<typeof getAiConfig>>>) {
  // 扫描目录，新文件入库
  const files = scanMemberImages(member);
  for (const f of files) upsertImage(member, f.phase, f.filename);

  const images = getImagesByMember(member);
  const todo = images.filter(i => !i.classified);
  const queue = [...todo];

  const worker = async () => {
    while (queue.length > 0) {
      if (scanState.stopping) break;
      const record = queue.shift();
      if (!record) break;
      scanState.processing++;
      try {
        const base64 = await getOrCompressThumbBase64(record);
        const result = await classifyWithAi(base64, config);
        updateImage(record.id, {
          body_part: result.body_part,
          ai_confidence: result.confidence,
          classified: 1,
        });
        scanState.okCount++;
      } catch { scanState.failCount++; }
      scanState.done++;
      scanState.processing--;
    }
  };
  await Promise.all(Array.from({ length: 10 }, () => worker()));



  // 阶段三：围度读数（只读 tape_reading 为 NULL 的已分类围度图，保留手动修正值）
  scanState.stage = "读取围度读数";
  const tapeTargets = getImagesByMember(member).filter(i =>
    i.classified === 1 && i.body_part?.startsWith("围度") && i.tape_reading == null);
  scanState.total += tapeTargets.length;
  const tapeQueue = [...tapeTargets];
  const tapeWorker = async () => {
    while (tapeQueue.length > 0) {
      if (scanState.stopping) break;
      const record = tapeQueue.shift();
      if (!record) break;
      scanState.processing++;
      try {
        const base64 = await getOrCompressThumbBase64(record);
        const reading = await readTape(base64, config);
        if (reading != null) { updateImage(record.id, { tape_reading: reading }); scanState.tapeOk++; }
        else scanState.tapeFail++;
      } catch { scanState.tapeFail++; }
      scanState.done++;
      scanState.processing--;
    }
  };
  await Promise.all(Array.from({ length: 10 }, () => tapeWorker()));
}

/** 全会员扫描 */
async function runScanAll() {
  const config = getAiConfig();
  if (!config) { scanState.running = false; return; }
  try {
    const members = getMembers();
    scanState.membersTotal = members.length;
    scanState.membersDone = 0;
    scanState.done = 0;
    scanState.total = 0;
    scanState.okCount = 0; scanState.failCount = 0; scanState.tapeOk = 0; scanState.tapeFail = 0; scanState.stopping = false;
    scanState.stage = "识别中";

    // 预统计待识别总数
    for (const m of members) {
      const files = scanMemberImages(m);
      for (const f of files) upsertImage(m, f.phase, f.filename);
      scanState.total += getImagesByMember(m).filter(i => !i.classified).length;
    }

    for (const m of members) {
      scanState.currentMember = m;
      await processMember(m, config);
      scanState.membersDone++;
    }
  } finally {
    scanState.running = false;
    scanState.stage = "";
    scanState.currentMember = "";
  }
}

/** 单会员扫描 */
async function runScan(member: string) {
  const config = getAiConfig();
  if (!config) { scanState.running = false; return; }
  try {
    scanState.membersTotal = 1;
    scanState.membersDone = 0;
    scanState.total = 0;
    scanState.okCount = 0; scanState.failCount = 0; scanState.tapeOk = 0; scanState.tapeFail = 0; scanState.stopping = false;
    scanState.done = 0;
    scanState.currentMember = member;
    scanState.stage = "识别中";
    const images = getImagesByMember(member);
    scanState.total = images.filter(i => !i.classified).length;
    await processMember(member, config);
    scanState.membersDone++;
  } finally {
    scanState.running = false;
    scanState.stage = "";
    scanState.currentMember = "";
  }
}


function startServer(): ReturnType<typeof serve> {
  const basePort = Number(process.env.PORT) || Number((process.argv.find(a => a.startsWith("--port=")) ?? "").split("=")[1]) || 3000;
  const routes = {
    // ---- Members ----
    "/api/members": {
      GET() {
        // 扫描磁盘入库，未打开过的会员也能显示真实数量（而非默认无图）
        for (const name of getMembers()) {
          for (const f of scanMemberImages(name)) upsertImage(name, f.phase, f.filename);
        }
        const stats = getMemberStats();
        return json(getMembers().map(name => ({
          name,
          total: stats[name]?.total ?? 0,
          classified: stats[name]?.classified ?? 0,
        })));
      },
      async POST(req: RouteReq) {
        const body = await req.json().catch(() => ({})) as { name?: string };
        const name = (body.name ?? "").trim();
        if (!name) return json({ error: "会员姓名不能为空" }, 400);
        if (/[\\\\/:*?"<>|]/.test(name)) return json({ error: "姓名包含非法字符" }, 400);
        if (memberExists(name)) return json({ error: `会员「${name}」已存在` }, 400);
        createMemberDirs(name);
        return json({ ok: true });
      },
    },

    "/api/members/:name/images": {
      GET(req: RouteReq) {
        const member = req.params.name!;
        const files = scanMemberImages(member);
        for (const f of files) {
          upsertImage(member, f.phase, f.filename);
        }
        const images = getImagesByMember(member);
        return json(images);
      },
    },

    // ---- AI 扫描（后台运行，前端轮询状态） ----
    "/api/members/:name/scan": {
      POST(req: RouteReq) {
        const member = req.params.name!;
        const config = getAiConfig();
        if (!config) return json({ error: "AI 未配置" }, 400);
        if (scanState.running) return json({ error: "扫描已在进行中" }, 409);
        scanState.running = true;
        scanState.currentMember = member;
        runScan(member).catch(() => { scanState.running = false; });
        return json({ started: true });
      },
    },

    // ---- 全会员扫描 ----
    "/api/scan/all": {
      POST() {
        const config = getAiConfig();
        if (!config) return json({ error: "AI 未配置" }, 400);
        if (scanState.running) return json({ error: "扫描已在进行中" }, 409);
        scanState.running = true;
        runScanAll().catch(() => { scanState.running = false; });
        return json({ started: true });
      },
    },

    // ---- 停止扫描 ----
    "/api/scan/stop": {
      POST() {
        scanState.stopping = true;
        scanState.stage = "停止中";
        return json({ ok: true });
      },
    },

    "/api/scan/status": {
      GET() {
        return json(scanState);
      },
    },

    // ---- Image serving ----
    "/api/image/:id": {
      async GET(req: RouteReq) {
        const id = parseInt(req.params.id!);
        const record = getImageById(id);
        if (!record) return json({ error: "Image not found" }, 404);
        return serveFileWithCache(req, getImageFilePath(record));
      },
    },

    // ---- 压缩图（优先缓存，回退原图） ----
    "/api/image/:id/thumb": {
      async GET(req: RouteReq) {
        const id = parseInt(req.params.id!);
        const record = getImageById(id);
        if (!record) return json({ error: "Image not found" }, 404);
        const tp = getThumbPath(id);
        return serveFileWithCache(req, existsSync(tp) ? tp : getImageFilePath(record));
      },
    },

    // ---- Image updates ----
    "/api/images/:id": {
      async PUT(req: RouteReq) {
        const id = parseInt(req.params.id!);
        const body = await req.json() as Record<string, unknown>;
        updateImage(id, body as never);
        return json({ ok: true });
      },
    },

    // ---- AI classify（单张；无上传时服务端自动压缩/用缓存） ----
    "/api/images/:id/classify": {
      async POST(req: RouteReq) {
        const id = parseInt(req.params.id!);
        const config = getAiConfig();
        if (!config) return json({ error: "AI 未配置" }, 400);

        const body = await req.json().catch(() => ({ image: "" })) as { image?: string };
        const record = getImageById(id);
        if (!record) return json({ error: "Image not found" }, 404);

        try {
          let base64: string;
          if (body.image) {
            const raw = body.image.startsWith("data:") ? body.image.split(",")[1]! : body.image;
            saveThumb(id, Buffer.from(raw, "base64"));
            base64 = body.image;
          } else {
            base64 = await getOrCompressThumbBase64(record);
          }
          const result = await classifyWithAi(base64, config);
          updateImage(id, {
            body_part: result.body_part,
            ai_confidence: result.confidence,
            classified: 1,
          });
          return json(result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "AI 识别失败";
          return json({ error: msg }, 500);
        }
      },
    },

    // ---- AI Config ----
    "/api/config": {
      GET() {
        const config = getAiConfig();
        if (!config) return json(null);
        return json({
          base_url: config.base_url,
          model: config.model,
          api_key: config.api_key.length > 4
            ? config.api_key.substring(0, 4) + "****"
            : "****",
        });
      },
      async PUT(req: RouteReq) {
        const body = await req.json() as { base_url: string; model: string; api_key: string };
        if (!body.base_url || !body.model || !body.api_key) {
          return json({ error: "base_url, model, api_key 均为必填" }, 400);
        }
        saveAiConfig(body);
        return json({ ok: true });
      },
      DELETE() {
        deleteAiConfig();
        return json({ ok: true });
      },
    },

    "/api/config/test": {
      async POST(req: RouteReq) {
        const body = await req.json() as { base_url: string; model: string; api_key: string };
        const result = await testAiConnection(body);
        return json(result);
      },
    },

    // ---- Compositions ----
    "/api/compositions": {
      async POST(req: RouteReq) {
        const body = await req.json() as { member: string; body_part: string; layout?: string };
        if (!body.member || !body.body_part) return json({ error: "Missing fields" }, 400);
        const id = saveComposition(body.member, body.body_part, body.layout ?? "{}");
        return json({ id });
      },
    },

    // 该会员全部已保存布局
    "/api/compositions/:member": {
      GET(req: RouteReq) {
        return json({ items: getCompositionsByMember(req.params.member!) });
      },
    },

    // 读取已保存布局
    "/api/compositions/:member/:part": {
      GET(req: RouteReq) {
        const layout = getCompositionLayout(req.params.member!, req.params.part!);
        return json({ layout });
      },
    },

    // ---- Export ----
    "/api/export": {
      async POST(req: RouteReq) {
        const formData = await req.formData();
        const member = formData.get("member") as string;
        const bodyPart = formData.get("body_part") as string;
        const layout = formData.get("layout") as string | null;
        const file = formData.get("image") as File | null;

        if (!member || !bodyPart || !file) {
          return json({ error: "Missing fields" }, 400);
        }

        if (layout) saveComposition(member, bodyPart, layout);

        const buffer = new Uint8Array(await file.arrayBuffer());
        const filepath = exportImage(member, bodyPart, buffer);
        markExported(member, bodyPart);

        return json({ ok: true, filepath });
      },
    },

    // ---- 品牌素材（logo / 二维码，可替换） ----
    "/api/assets": {
      async POST(req: RouteReq) {
        const formData = await req.formData();
        const kind = formData.get("kind") as string | null;
        const file = formData.get("image") as File | null;
        if ((kind !== "logo" && kind !== "qr") || !file) return json({ error: "参数不合法" }, 400);
        if (file.size > 5 * 1024 * 1024) return json({ error: "图片不能超过 5MB" }, 400);
        if (!file.type.startsWith("image/")) return json({ error: "请上传图片文件" }, 400);
        const buffer = new Uint8Array(await file.arrayBuffer());
        saveAsset(kind, buffer);
        return json({ ok: true });
      },
    },

    "/api/assets/:kind": {
      GET(req: RouteReq) {
        const kind = req.params.kind!;
        const path = getAssetPath(kind);
        if (!path) return json({ error: "Unknown asset" }, 404);
        if (existsSync(path)) {
          return new Response(Bun.file(path), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
        }
        const dataUrl = kind === "logo" ? EMBEDDED_LOGO : EMBEDDED_QR;
        const buf = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
        return new Response(buf, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
      },
      DELETE(req: RouteReq) {
        const kind = req.params.kind!;
        if (kind !== "logo" && kind !== "qr") return json({ error: "参数不合法" }, 400);
        deleteAsset(kind);
        return json({ ok: true });
      },
    },

    // ---- 海报保存 ----
    "/api/poster": {
      async POST(req: RouteReq) {
        const formData = await req.formData();
        const member = formData.get("member") as string | null;
        const file = formData.get("image") as File | null;
        if (!member || !file) return json({ error: "Missing fields" }, 400);
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, "0");
        const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
        const buffer = new Uint8Array(await file.arrayBuffer());
        const filepath = savePoster(member, `长图海报-${ts}.png`, buffer);
        return json({ ok: true, filepath });
      },
    },

    // ---- 全局设置 ----
    "/api/settings": {
      GET() {
        return json({ center: getSetting("watermark_center") ?? DEFAULT_CENTER_TEXT, address: getSetting("poster_address") ?? DEFAULT_POSTER_ADDRESS, phone: getSetting("poster_phone") ?? DEFAULT_POSTER_PHONE });
      },
      async PUT(req: RouteReq) {
        const body = await req.json() as { center?: string; address?: string; phone?: string; overrideSaved?: boolean };
        const center = (body.center ?? "").trim();
        if (body.center !== undefined) {
          if (!center) return json({ error: "水印文字不能为空" }, 400);
          setSetting("watermark_center", center);
        }
        if (body.address !== undefined) setSetting("poster_address", body.address.trim());
        if (body.phone !== undefined) setSetting("poster_phone", body.phone.trim());
        let updated = 0;
        const effCenter = center || getSetting("watermark_center") || DEFAULT_CENTER_TEXT;
        if (body.overrideSaved) {
          for (const row of getAllCompositionLayouts()) {
            try {
              if (!row.layout) continue;
              const parsed = JSON.parse(row.layout) as unknown;
              let next: string | null = null;
              if (Array.isArray(parsed)) {
                next = JSON.stringify({
                  transforms: parsed,
                  watermark: { center: effCenter, before: "前", after: "后", title: compositionLabel(row.body_part) },
                });
              } else if (parsed && typeof parsed === "object") {
                const obj = parsed as { watermark?: Record<string, unknown> };
                if (obj.watermark) { obj.watermark.center = effCenter; next = JSON.stringify(parsed); }
              }
              if (next) { updateCompositionLayoutById(row.id, next); updated++; }
            } catch { /* 跳过异常布局 */ }
          }
        }
        return json({ ok: true, updated });
      },
    },

    // ---- Clear Data ----
    "/api/data": {
      DELETE() {
        clearAllData();
        clearThumbs();
        return json({ ok: true });
      },
    },

    // ---- Static ----
    "/*": index,

  };

  const development = process.env.NODE_ENV !== "production" && { hmr: true, console: true };
  for (let p = basePort; p <= basePort + 10; p++) {
    try {
      return serve({ port: p, routes, development });
    } catch (e) {
      if ((e as { code?: string }).code === "EADDRINUSE") {
        if (p === basePort) console.log(`端口 ${p} 被占用，自动改用 ${p + 1}…`);
        continue;
      }
      throw e;
    }
  }
  throw new Error("找不到可用端口");
}

const server = startServer();
console.log(`🚀 VSIT server running at ${server.url}`);

// 打包版双击启动：自动打开浏览器（bun dev 开发模式不自动打开）
// 浏览器只是客户端，关闭网页不影响服务端（后台 AI 识别继续）；关闭本终端窗口才真正退出
// 编译版中 argv[0] 为 bun 而 execPath 为 exe 自身路径；dev 模式两者相同（bun.exe）
const isCompiledExe = process.argv[0] !== process.execPath;
if (isCompiledExe) {
  try {
    openInBrowser(server.url.toString());
  } catch { /* 打开失败不影响服务 */ }
}
