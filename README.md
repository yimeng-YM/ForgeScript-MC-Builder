# ForgeScript

ForgeScript 是一个专为 **Minecraft Java Edition** 设计的 AI 辅助建筑工作台。用户可以通过与大语言模型对话生成受控 JavaScript 建筑脚本，在安全的 QuickJS 沙箱中执行并渲染生成 3D 预览，进行版本化的 BlockState 与红石线路静态校验，并最终导出可直接被游戏内 Litematica 模组加载的 `.litematic` 投影文件。

---

## 💡 核心特性

- 🤖 **AI 驱动的建筑意图生成**
  - 支持多供应商 AI 模型（OpenAI 兼容、Anthropic、Google Gemini 等）。
  - 对话流智能修补（Patching）现有代码，避免每次重写全文，极大地降低 Token 成本。
  - 未配置 API Key 时，自动降级为**本地演示生成器**，支持零配置体验。

- 🔒 **受控沙箱运行时**
  - 使用 `quickjs-emscripten` (WebAssembly QuickJS) 将不安全的代码完全隔离。
  - 严格限制执行时间（默认 2 秒，最高 10 秒）、内存配额（64MB）与方块数量上限，防止死循环和内存泄露导致浏览器崩溃。
  - 重写非确定性方法（如 `Math.random`），由项目 seed 驱动，确保多次运行结构完全等价。

- 🗺️ **3D 实时渲染与交互**
  - 基于 Three.js 实现高置信度 3D 结构渲染。
  - 支持 X-Ray 透视、仅红石层过滤器以及 Y 轴切片。
  - 画布级方块交互：点击即可通过检查器（Inspector）追溯 BlockState 属性。

- 🚦 **红石级静态校验**
  - 根据选定版本的注册表，校验每一个 BlockState 属性和合法值（例如楼梯朝向、栅栏连接）。
  - **红石逻辑拓扑检测**：自动计算 `redstone_wire` 在直行、拐角、斜向爬墙等不同拓扑结构下的几何连接方向；自动校验中继器、比较器、侦测器的更新方向。

- 📦 **开箱即用导出**
  - 支持 V6 / V7 版本的 `.litematic` 二进制编译输出。
  - 大端 NBT 编码 + GZip 压缩，直接在浏览器端实现 BigInt 到 64-bit 跨界 long array 打包。

---

## 🛠️ 技术栈与架构设计

项目采用前后端一体化的边缘计算架构：
- **前端框架**：React 19 + TypeScript + Tailwind CSS (shadcn/ui)
- **编译/路由引擎**：Vinext (基于 Vite + Cloudflare Worker 优化版 Next.js 构建工具)
- **3D 渲染**：Three.js + OrbitControls
- **代码沙箱**：quickjs-emscripten (WASM)
- **部署环境**：Cloudflare Workers / Pages

### 💻 本地开发

1. **安装依赖**
   ```bash
   npm install
   ```

2. **生成方块配置包 (Version Packs)**
   提取不同游戏版本（`1.12.2` - `1.21.11` 共 14 个版本）的方块Manifest：
   ```bash
   npm run profiles:generate
   ```

3. **启动本地开发服务**
   ```bash
   npm run dev
   ```

---

## 🚀 部署至 Cloudflare Workers

项目在构建部署时，针对 Cloudflare Worker 的**免费额度大小限制 (3 MiB)** 进行了深度优化：

### 优化机制（包体积骤降 97%）
- **客户端隔离渲染 (Client-Only Isolation)**：在 `vite.config.ts` 中配置了 `childEnvironments: []`，使重型的 `three` (3D引擎) 和 `shiki` (代码高亮) 库完全不在服务端初始化（SSR）。
- **按需 Shiki 高亮打包**：对 `code-block.tsx` 进行了重构，移除全量 highlighter，改用 core 接口并仅在构建中打包 `javascript` 和 `json` 两类必要的语法库，彻底清除了其他 400+ 个无用动态 JS 块。
- **构建结果**：服务端 `ssr` 包体积由 **32M 骤降为 966KB**，压缩上传包仅约 **698KB**。

### 部署命令

由于本地配置已经就绪，直接运行以下命令即可上传部署：

```bash
# 构建生成 dist/
npm run build

# 部署至 Cloudflare Workers
npx wrangler deploy --config dist/server/wrangler.json
```

*注意：Cloudflare 默认分配的 `*.workers.dev` 域名在部分地区可能存在连接受限。建议在 Cloudflare 网页后台，点击项目的 `Settings -> Triggers -> Custom Domains` 绑定你自己的自定义域名以获得秒开访问。*

---

## 🧪 自动化验证与测试

我们保证项目的核心算法及导出层拥有高覆盖率的自动化回归测试。

```bash
# 格式语法检查
npm run lint

# TypeScript 类型校验
npx tsc --noEmit

# 运行单元测试（包含 Gzip 校验、沙箱超时测试、红石拓扑一致性测试）
npm test
```
