// 品牌素材再生成：桌面 logo.png / 微信二维码.png → 压缩 → src/assets.embed.ts
// 用法：bun run assets（可带参数覆盖源路径：bun tools/rebuild-assets.ts <logo路径> <二维码路径>）
import { homedir } from "os";
import { join } from "path";
import { existsSync, writeFileSync } from "fs";

const desktop = join(homedir(), "Desktop");
// 优先项目内素材（随仓库走），不存在时回退桌面
const pick = (projectRel: string, desktopName: string) => {
  const inRepo = join("tools", "assets-src", projectRel);
  if (existsSync(inRepo)) return inRepo;
  return join(desktop, desktopName);
};
const logoSrc = process.argv[2] ?? pick("logo.png", "logo.png");
const qrSrc = process.argv[3] ?? pick("wechat-qr.png", "微信二维码.png");

async function toDataUrl(path: string, maxSide: number, label: string): Promise<string> {
  if (!existsSync(path)) throw new Error(`找不到源文件: ${path}（${label}）`);
  const buf = await Bun.file(path).image()
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  console.log(`${label}: ${path} → ${buf.byteLength} bytes`);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const logo = await toDataUrl(logoSrc, 480, "logo");
const qr = await toDataUrl(qrSrc, 560, "二维码");

const out = `// 由 tools/rebuild-assets.ts 自动生成，勿手改。重新生成：bun run assets
export const EMBEDDED_LOGO = "${logo}";
export const EMBEDDED_QR = "${qr}";
`;
writeFileSync("src/assets.embed.ts", out, "utf8");
console.log("已写入 src/assets.embed.ts");
