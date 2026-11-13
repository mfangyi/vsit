# VSIT (Victoria's Secret Image Tool)

## 项目概述

VSIT 是一个瑜伽馆体态对比照片工具，基于 Bun + React 19 构建，尽量少用第三方库。核心功能：

- 从 `桌面\vsit\原始图\{会员姓名}\训练前\` 和 `训练后\` 读取照片
- 通过 AI（OpenAI 兼容接口）自动识别每张照片对应的身体部位
- 围度照片额外由 AI 读取软尺刻度值
- 在网页 Canvas 中将训练前后同部位照片左右拼合（每张裁剪为 2:3 纵图 → 拼合后 4:3 横图）
- 特殊：围度-大腿和围度-手臂各由 4 张原图（左/右 × 前/后）拼合为 2×2 网格
- 支持缩放、平移、旋转，所见即所得
- 确认后导出为 JPG 高质量图到 `桌面\vsit\成品图\{会员姓名}\`
- SQLite 存储部位分类、围度读数、AI 配置，支持一键清空

## 技术栈与架构

- **运行时/服务端**：Bun 1.4.4（`Bun.serve` 做 HTTP 服务，`bun:sqlite` 做数据库）
- **前端**：React 19 + Canvas API（图像编辑零第三方库）
- **图像压缩**：服务端 `Bun.Image` 将原图（3072×4096）压缩为最长边 ≤1024px 的 JPEG（quality 80，自动 EXIF 纠向）缓存到 thumbs 后送 AI，省 token 并加速
- **AI 接口**：OpenAI 兼容格式（`/chat/completions`），支持 Vision 输入（base64 image）
- **AI 并发**：固定并发数 10

## 数据目录结构

```
桌面\vsit\
  原始图\
    {会员姓名}\
      训练前\    ← 原始照片 (JPG, 3072×4096)
      训练后\    ← 原始照片
  成品图\
    {会员姓名}\  ← 导出成品图 ({部位名}.jpg)

%LOCALAPPDATA%\vsit\
  vsit.db         ← SQLite（识别结果、AI 配置、布局）
  thumbs\{id}.jpg ← 压缩图缓存
```

## SQLite 数据库

数据库文件：`%LOCALAPPDATA%\vsit\vsit.db`，使用 `bun:sqlite`。

```sql
-- AI 配置（单行，每次修改覆盖）
CREATE TABLE IF NOT EXISTS ai_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key TEXT NOT NULL
);

-- 图片识别结果
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member TEXT NOT NULL,
  phase TEXT NOT NULL,          -- '训练前' | '训练后'
  filename TEXT NOT NULL,
  body_part TEXT NOT NULL,      -- 19 个分类枚举值之一
  tape_reading REAL,            -- 围度软尺读数（仅围度类），NULL=非围度
  crop_x REAL DEFAULT 0,        -- Canvas 裁剪偏移（归一化 0-1）
  crop_y REAL DEFAULT 0,
  crop_scale REAL DEFAULT 1,
  crop_rotation REAL DEFAULT 0, -- 旋转角度（度）
  ai_confidence REAL,           -- AI 置信度 0-1
  UNIQUE(member, phase, filename)
);

-- 拼合记录
CREATE TABLE IF NOT EXISTS compositions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member TEXT NOT NULL,
  body_part TEXT NOT NULL,
  image_ids TEXT,               -- JSON 数组：2图=[前ID,后ID]，4图=[左前,左后,右前,右后]
  layout TEXT,                  -- Canvas 布局状态 JSON
  exported INTEGER DEFAULT 0,   -- 是否已导出
  UNIQUE(member, body_part)
);
```

## 身体部位分类（AI 识别，19 项，硬编码）

AI 对每张原图识别出以下 19 个分类之一：

```
体态-全身-正面垂手    体态-全身-正面抬手
体态-全身-背面垂手    体态-全身-背面抬手
体态-全身-左面垂手    体态-全身-左面抬手
体态-全身-右面垂手    体态-全身-右面抬手
体态-背部             体态-背部上肢-左   体态-背部上肢-右
围度-大腿-左          围度-大腿-右
围度-肋骨             围度-上腹
围度-中腹             围度-下腹
围度-手臂-左          围度-手臂-右
```

围度类（需要 AI 读软尺刻度）：围度-大腿-左、围度-大腿-右、围度-肋骨、围度-上腹、围度-中腹、围度-下腹、围度-手臂-左、围度-手臂-右

## 成品图输出（17 张，由 19 个分类拼合）

每阶段输入 19 张图（19×2=38 张原图），输出 17 张成品图：

| 成品图文件名 | 输入图（训练前/后） | 布局 |
|---|---|---|
| 体态-全身-正面垂手 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-全身-正面抬手 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-全身-背面垂手 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-全身-背面抬手 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-全身-左面垂手 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-全身-左面抬手 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-全身-右面垂手 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-全身-右面抬手 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-背部 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-背部上肢-左 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 体态-背部上肢-右 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| **围度-大腿** | 左腿前+左腿后+右腿前+右腿后 → 共4张 | **2×2 网格**（上行=左腿前+后，下行=右腿前+后） |
| 围度-肋骨 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 围度-上腹 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 围度-中腹 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| 围度-下腹 | 各1张 → 共2张 | 左右并排 4:3 横图 |
| **围度-手臂** | 左臂前+左臂后+右臂前+右臂后 → 共4张 | **2×2 网格**（上行=左臂前+后，下行=右臂前+后） |

## AI 识别流程

1. 服务端 `Bun.Image` 压缩原图（≤1024px JPEG q80）并缓存至 `thumbs/{id}.jpg`
2. 两阶段扫描（并发 10）：阶段一分类（不含读数，超时 60s/次则跳过该图）；阶段二对已分类围度图单独读取软尺数字；结束后弹汇总（成功/跳过/读数），跳过项可再点识别重试；`POST /api/scan/stop` 可中止。分类 Prompt 返回：

```json
{
  "body_part": "围度-上腹",
  "tape_reading": 72.5,
  "confidence": 0.95
}
```

- 非围度照片 `tape_reading` 为 `null`
- AI 未连接时仅可用图片编辑功能（无自动识别）
- AI 识别失败时用户可手动为每张图指定部位

## AI 配置

- 网页中可配置 `base_url`、`model`、`api_key`
- 快捷输入预设（点击即填入）：
  - base_url: `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
  - base_url: `https://tokenhub.tencentmaas.com/v1`
  - model: `qwen3.8-flash`
  - model: `glm-5.3-flash`
- "测试连接"：发送简单请求验证 API 可用性
- "断开连接"：清空 ai_config 表，仅图片编辑功能可用
- 配置存入 SQLite 持久化，直至下次修改

## Canvas 编辑器（核心交互）

- 左右分屏：左侧显示训练前图片，右侧显示训练后图片
- 每张图片可独立调整：缩放（鼠标滚轮）、平移（拖拽）、旋转
- 裁剪区域固定为 2:3 纵向比例，不留白边
- 实时预览拼合效果：两图并排 = 4:3 横图
- 特殊布局（围度-大腿/围度-手臂）：2×2 网格，上行=左侧前+后，下行=右侧前+后
- 围度照片显示 AI 读数，用户可人工核对修改
- "确认导出"按钮：将 Canvas 内容渲染为 JPG（quality ≥ 0.9），输出到 `成品图\` 目录
- 导出文件名：`{部位名}.jpg`（如 `围度-上腹.jpg`）

## HTTP API

```
GET    /api/members                        → 会员列表（含 total/classified 统计，顺带扫盘入库）
POST   /api/members                        → 新建会员（创建 原始图\{name}\训练前·训练后）
GET    /api/members/:name/images           → 列出训练前/后图片及识别状态
POST   /api/members/:name/scan             → 单会员后台扫描
POST   /api/scan/all                       → 全会员后台扫描（并发 10）
POST   /api/scan/stop                      → 停止扫描（在途请求自然结束）
GET    /api/scan/status                    → 扫描进度与汇总计数（ok/fail/tapeOk/tapeFail）
PUT    /api/images/:id                     → 更新识别结果/裁剪参数
GET    /api/compositions/:member           → 该会员全部拼合记录（layout + exported）
GET    /api/compositions/:member/:part     → 读取单个已保存布局
POST   /api/compositions                   → 保存拼合布局（v2：transforms + watermark）
POST   /api/export                         → 导出成品图（multipart，自动 markExported）
POST   /api/poster                         → 保存长图海报（multipart，存 桌面\vsit\海报\{会员}\）
GET/POST/DELETE /api/assets/:kind          → 品牌素材 logo|qr（默认内嵌，POST 上传替换存 AppData，DELETE 恢复默认）
POST   /api/assets                         → 上传替换素材（multipart kind+image）
GET/PUT /api/settings                      → 全局设置（中央水印默认 + 海报地址/电话；PUT 可选覆盖已存布局）
GET    /api/config                         → 获取 AI 配置（api_key 脱敏）
PUT    /api/config                         → 保存 AI 配置
POST   /api/config/test                    → 测试 AI 连接
DELETE /api/config                         → 断开连接
DELETE /api/data                           → 清空全部缓存（SQLite + thumbs）
GET    /api/image/:id                      → 原图（ETag 协商缓存）
GET    /api/image/:id/thumb                → 压缩图缓存，缺失回退原图（ETag）
```

## 关键约束与注意事项

- 尽量少用第三方库：图像处理全用 Canvas API，数据库用 `bun:sqlite`
- 原始图片不做任何修改，成品图只写入 `成品图\` 目录
- SQLite 数据库文件存放在 `%LOCALAPPDATA%\vsit\` 目录
- AI 识别用的压缩图（≤1024px JPEG）缓存于 `%LOCALAPPDATA%\vsit\thumbs\{图片ID}.jpg`，"清空全部缓存"会同时清空识别数据和压缩图缓存
- 网页中提供"清空全部缓存"按钮，清空所有表数据
- AI 识别不可用时，图片编辑功能（Canvas 拼合）仍然完整可用
- 导出格式：JPG 高质量（quality ≥ 0.9）
- 前后端通信时原图通过 `/api/image/:id` 加载，避免前端直接访问文件系统
- 原图分辨率为 3072×4096（竖版），拼合后成品图约为 4:3 横版

## 开发命令

```bash
bun install       # 安装依赖
bun dev           # 启动开发服务器（热重载）
bun build         # 构建生产版本
bun typecheck     # TypeScript 检查
bun run package  # 打包单文件 exe → dist\VSIT.exe（内嵌运行时，目标机器免装 Bun）
```

## 打包发布（自动执行）

打包命令：`bun run package` → 产出 `dist\VSIT.exe`（内嵌 Bun 运行时 + 前端资源与 SQLite，目标机器免安装 Bun/Node）。

**工作流要求：每次完成代码改动（src/ 下文件变更）后，自动执行一次 `bun run package` 重新打包**，确保 `dist\VSIT.exe` 发布产物始终与最新代码同步，无需人工触发。

## Git 版本管理（自动执行）

**每完成一批 src/ 改动并验证通过后：`git add -A` → `git commit`（一句话中文信息）；大功能收尾时打 tag（如 `git tag v1.0`）。仓库仅本地，不推远程。**
首版基线：tag `v1.0`（AI识别 / 拼合编辑 / 水印导出 / 口碑长图 / 单文件打包）。


## 品牌素材

Logo 与二维码以 base64 内嵌于 `src/assets.embed.ts`（打包进 exe）。更换桌面素材后运行 `bun run assets` 重新生成，再 `bun run package`。
用户也可在「AI 与全局设置」上传替换（存 `%LOCALAPPDATA%\vsit\assets\`，优先于内嵌默认，可一键恢复）。
## 项目结构（规划）

```
src/
  index.ts          ← Bun 服务端入口（HTTP 路由 + SQLite + AI 代理）
  frontend.tsx      ← React 入口
  App.tsx           ← 主应用组件（页面路由/Tab 切换）
  index.css         ← 全局样式
  index.html        ← HTML 模板
  components/
    AiConfigPanel.tsx    ← AI 配置面板（base_url/model/api_key/快捷输入/测试/断开）
    MemberPanel.tsx      ← 会员列表与图片扫描面板
    ImageClassifier.tsx  ← AI 识别结果展示与手动修正
    CanvasEditor.tsx     ← 核心 Canvas 拼合编辑器（缩放/平移/旋转/导出）
    TapeReadingEditor.tsx ← 围度软尺读数核对
  server/
    db.ts            ← SQLite 初始化与 CRUD
    ai.ts            ← AI 识别代理（并发控制、压缩、Prompt）
    fs.ts            ← 文件系统操作（扫描目录、导出）
  types.ts           ← 共享类型定义
```
