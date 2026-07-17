# ForgeScript

ForgeScript 是一个 Minecraft Java Edition AI 建筑工作台：用户通过对话生成受控 JavaScript，脚本在 QuickJS 沙箱中执行，随后进入版本化方块状态校验、Three.js 预览与 `.litematic` 编译流程。

## 当前可用能力

- 侧边栏 AI 对话，未配置云端模型时自动使用本地建筑演示模式。
- 前端“模型与生成设置”支持 AI Gateway、OpenAI 兼容接口、Anthropic 原生和 Google Gemini 原生协议。
- 内置 OpenAI、DeepSeek、OpenRouter、SiliconFlow、Moonshot、Qwen、GLM、Ollama 与 LM Studio 等预设，也可填写自定义 Base URL、认证方式和请求头。
- 可配置 Temperature/Top P、Token 上限、工具步数、重试、超时、随机种子，以及工程级方块状态与红石精度策略。
- `3D 预览 / JavaScript / 校验` 三种主视图。
- 受控 `mc.build()` SDK，支持 `set`、`fill`、`hollowBox`、`walls`、`line`、`pillar` 和 `replace`。
- QuickJS 内存、堆栈、执行时间和最大方块数限制。
- 14 个可按需加载的版本包，覆盖 `1.12.2` 至 `1.21.11`，共 13,157 条方块定义。
- BlockState 属性和值按项目版本校验，包含红石功能方块的显式朝向提示。
- V6/V7 `.litematic` 基础导出，使用大端 NBT、GZip、调色板和跨 64 位 bit packing。
- `26.1.2` 与 `26.2` 已显示在实验通道；完整 registry 发布前不会伪装成可导出版本。

## 本地运行

```bash
npm install
npm run dev
```

打开终端输出中的本地地址。默认不需要密钥即可体验生成、运行、预览和导出。

### 配置大模型

点击工作台右上角齿轮，或对话栏标题旁的模型徽标：

1. 选择供应商预设或“自定义 OpenAI 兼容接口”。
2. 填写模型 ID、Base URL 和 API Key。
3. 使用“测试连接”验证真实调用，再保存设置。

普通偏好保存在浏览器 `localStorage`。API Key 默认只保存在当前标签页的 `sessionStorage`，关闭标签页后清除；密钥不会写入源码、构建产物或长期本地存储。部署环境必须使用 HTTPS。

管理员也可以复制 `.env.example` 为 `.env.local`，通过服务端环境变量提供密钥。自动模式支持 `AI_GATEWAY_API_KEY` / `VERCEL_OIDC_TOKEN` 和可选的 `LLM_MODEL`；各原生供应商也有对应环境变量。前端未填写密钥时会尝试服务端配置。

Ollama 与 LM Studio 的 `localhost` 预设只适用于本地运行的 ForgeScript。托管网页无法访问用户电脑上的本机模型服务。

## 验证

```bash
npm run profiles:generate
npm run lint
npx tsc --noEmit
npm test
```

完整产品和技术路线见 `docs/PRODUCT_PLAN.md`。
