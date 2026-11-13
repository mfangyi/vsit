# VSIT (Victoria's Secret Image Tool)

瑜伽馆体态对比照片工具：AI 自动识别体态/围度照片 → Canvas 拼合训练前后对比图（缩放/平移/旋转，所见即所得）→ 一键导出带水印的成品图。

## 环境要求

- Windows
- [Bun](https://bun.sh) 1.4+（**仅开发机需要**；打包产物为内嵌运行时的单文件 exe，目标机器免安装）

## 数据目录

| 位置 | 内容 |
|---|---|
| `桌面\vsit\原始图\{会员}\训练前 · 训练后\` | 原始照片（JPG） |
| `桌面\vsit\成品图\{会员}\` | 导出的成品图（{部位名}.jpg） |
| `%LOCALAPPDATA%\vsit\vsit.db` | SQLite（识别结果、AI 配置、拼合布局） |
| `%LOCALAPPDATA%\vsit\thumbs\` | 压缩图缓存 |

## 常用命令

```bash
bun install      # 安装依赖
bun dev          # 开发服务器 http://localhost:3000（热重载）
bun typecheck    # TypeScript 检查
bun run package  # 打包单文件 exe → dist\VSIT.exe
```

## 打包与部署

打包为内嵌 Bun 运行时的单文件 exe，目标电脑**免安装 Bun/Node**：

```bash
bun run package
```

产物：`dist\VSIT.exe`（约 111MB，含前端资源与 SQLite）。

部署到其它电脑：

1. 拷贝 `dist\VSIT.exe` 到目标电脑任意位置
2. 拷贝 `桌面\vsit\` 数据目录到目标电脑桌面（可选拷贝 `%LOCALAPPDATA%\vsit\` 以带走 AI 配置与缓存）
3. 双击 `VSIT.exe`，浏览器打开 `http://localhost:3000`

注意：固定监听 3000 端口；Windows 用户名不同无影响（所有路径基于当前用户目录计算）。
