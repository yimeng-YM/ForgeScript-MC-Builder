# ForgeScript

ForgeScript 是一个 Minecraft Java Edition AI 建筑工作台：用户通过对话生成受控 JavaScript，脚本在 QuickJS 沙箱中执行，随后进入版本化方块状态校验、Three.js 预览与 `.litematic` 编译流程。

## 当前可用能力

- 侧边栏 AI 对话，未配置云端模型时自动使用本地建筑演示模式。
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

如需真实大模型，在托管环境配置 `AI_GATEWAY_API_KEY` 或 `VERCEL_OIDC_TOKEN`。可选设置 `LLM_MODEL`，默认使用 `openai/gpt-5.4`。

## 验证

```bash
npm run profiles:generate
npm run lint
npx tsc --noEmit
npm test
```

完整产品和技术路线见 `docs/PRODUCT_PLAN.md`。

