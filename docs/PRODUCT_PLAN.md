# LLM MC Builder 产品与技术规划

> 状态：规划稿 v1。当前阶段只确定范围、架构、风险、验收与实施顺序，不开始 UI 和业务代码实现。
>
> 产品目标：用户通过侧边栏与大模型对话，让模型生成或修改受控 JavaScript 建筑脚本；脚本在隔离运行时中执行，形成可验证的 Minecraft Java Edition 结构数据；主窗口实时预览或查看源码，最终导出可被 Litematica 直接加载的 `.litematic` 文件。

## 1. 核心结论

### 1.1 产品不应让模型直接手写 NBT

模型应该生成 JavaScript，但 JavaScript 只调用稳定、版本化的建筑 SDK。SDK 产生统一的中间结构，随后由确定性的编译器写出 `.litematic`。

原因：

- `.litematic` 是 GZip 压缩的 NBT，不是 JSON 或普通文本。
- 方块数据使用“方块状态调色板 + 跨 64 位的 bit-packed long array”。
- BlockState、Block Entity NBT、实体、计划刻、元数据和 Minecraft DataVersion 都有独立兼容要求。
- 模型直接拼 NBT 很容易生成“扩展名正确但 Litematica 无法加载”的文件。
- 统一中间结构可以同时服务预览、源码检查、材料统计、撤销、导入和多格式导出。

推荐流水线：

```text
用户提示词
  -> AI 形成建筑意图与约束
  -> AI 查询目标版本的方块/状态定义
  -> AI 生成或补丁修改 JavaScript
  -> JS 沙箱执行，只能调用 Building SDK
  -> WorldDocument 中间结构
  -> 方块状态、NBT、坐标、红石规则校验
  -> 3D 预览与源码/诊断
  -> Litematic Compiler
  -> GZip NBT .litematic
```

### 1.2 “所有方块”必须是版本化能力

不能维护一份手写方块列表。每个 Minecraft 版本必须有一个 `MinecraftVersionProfile`，至少包含：

- 游戏版本号。
- Minecraft DataVersion。
- 对应的 Litematic Schema Version/SubVersion。
- 全部方块注册表 ID。
- 每个方块允许的 BlockState 属性、每个属性的合法值和默认状态。
- 方块模型、blockstates JSON、纹理和 tint 信息。
- Block Entity 类型与已知 NBT 模板。
- 版本别名、移除项和迁移规则。

多版本策略：

- 产品目标不是“只支持最新版”，而是支持从常用长期版本到当前稳定版的一组正式版本，并允许继续安装新的版本配置包。
- 首批正式验证矩阵建议包含：`1.16.5`、`1.18.2`、`1.19.2`、`1.19.4`、`1.20.1`、`1.20.4`、`1.20.6`、`1.21.1`、`1.21.4`、`1.21.8`、`1.21.10`、`1.21.11`、`26.1.x`、`26.2`。
- `1.12.2` 和 `1.13.2` 进入 Legacy 支持线：前者位于 Flattening 之前，后者是现代命名状态的早期边界，必须使用独立兼容测试，不能和新版本共用未经验证的转换逻辑。
- 其余 Java Edition 正式版本通过自动化构建流程生成版本包；满足完整验收后即可从“兼容支持”升级为“正式支持”。
- 新版本通过数据构建脚本和版本包加入，而不是修改核心业务代码。
- 项目一旦创建就锁定版本；显式执行“迁移版本”时才进行转换，并在迁移前复制项目、展示替换和不兼容项。
- 默认新建项目选择当前稳定版，但版本选择器优先显示用户最近使用的版本和常用长期版本。

### 1.3 “红石级精度”包含三层

1. **精确数据表达**：支持完整 BlockState、Block Entity NBT、计划方块刻和计划流体刻。
2. **静态正确性**：检查朝向、支撑、连接、状态值、相邻关系和常见红石结构规则。
3. **游戏内行为验证**：用指定 Minecraft 版本实际加载并验证。纯浏览器无法等价模拟 Minecraft 的完整更新顺序，因此高置信度验证应预留可选的本地 Fabric 验证器。

MVP 必须完成前两层；第三层作为高精度模式加入实施路线，不用虚假的“浏览器已完整模拟 Minecraft 红石”来掩盖边界。

## 2. 产品范围

### 2.1 必做能力

- 左侧对话栏：创建、解释、修改、修复建筑。
- 主窗口：`3D 预览 / JavaScript 源码 / 校验结果` 三种视图。
- AI 生成完整 JavaScript，也能对已有源码做局部补丁。
- 手工编辑代码并重新运行。
- 目标 Minecraft 版本选择、版本支持等级、版本包按需安装和项目版本锁定。
- 所选版本全部原版方块 ID 和 BlockState 属性可用。
- 支持技术方块，但对危险或不可正常获得的方块给出警告，不擅自禁止。
- 支持 Block Entity NBT，包括容器、告示牌、命令方块等需要 NBT 的方块。
- 支持多 Region、负坐标和非零原点。
- 实时材料表、尺寸、非空气方块数、体积和调色板统计。
- BlockState/NBT/结构/红石静态校验。
- 导入 `.litematic`，转换为内部结构；如果无法还原成优雅的原始生成算法，则生成等价的显式/分块源码表示。
- 导出 `.litematic`，导出前重新执行、校验、编译和回读验证。
- 本地项目历史、撤销/重做、自动保存和下载。
- 大模型供应商与模型可替换，服务端密钥不进入浏览器构建产物。

### 2.2 建议加入但不阻塞首个可用版本

- `.schem` 和 Vanilla Structure `.nbt` 导出。
- 自定义资源包预览。
- 自定义/模组方块注册表包导入。
- 结构模板库和可复用函数库。
- 对话分支、版本对比和两版建筑差异热力图。
- 一键生成生存建造层级、材料清单和分层说明。
- 本地 Fabric 验证器，对实际游戏加载、邻居更新和红石行为做烟雾测试。

### 2.3 明确不混入 MVP 的内容

- Bedrock Edition `.mcstructure`。
- 远程多人协作与账号系统。
- 在浏览器中完整复刻 Minecraft 服务端 tick/redstone 引擎。
- 任意 NPM 包导入、网络访问、文件访问或 DOM 访问的 AI 代码。
- 自动执行用户未审核的外部命令。
- 承诺把任意高版本结构无损降级到旧版本；不存在的方块不能无损转换。

## 3. 用户体验与界面信息架构

### 3.1 桌面布局

```text
┌──────────────── 顶部项目栏 ──────────────────────────────┐
│ 项目名 | MC 版本 | 状态 | 撤销/重做 | 运行 | 导出        │
├──────────────┬──────────────────────────────┬─────────────┤
│ 对话侧边栏   │ 主工作区                     │ 检查器      │
│              │ 3D / 源码 / 校验             │ 方块/NBT    │
│ 用户消息     │                              │ Region      │
│ AI 回复      │ 预览画布或 CodeMirror         │ 材料与警告  │
│ 变更卡片     │                              │             │
│              ├──────────────────────────────┤             │
│ 输入框       │ 可折叠诊断与运行日志          │             │
└──────────────┴──────────────────────────────┴─────────────┘
```

推荐宽度：

- 对话栏默认 340px，可拖动到 280–480px。
- 检查器默认 300px，可折叠。
- 主工作区占据剩余空间，保持为视觉中心。
- 小屏时对话栏和检查器变为抽屉；预览/源码仍是主页面。

### 3.2 顶部项目栏

- 项目名与保存状态。
- Minecraft 版本徽标；切换时走显式迁移流程。
- 点击版本徽标打开可搜索的版本选择器，按“最近使用、已安装、正式支持、兼容、实验”分组，并显示版本包大小、安装状态与校验日期。
- 新建项目可直接选择任一可用版本；已有项目选择其他版本时不能原地静默切换，而是进入“复制并迁移”向导。
- 版本选择器允许按系列筛选（Legacy、1.16、1.18、1.19、1.20、1.21、26.x），并明确标记快照或自定义版本包不保证可导入游戏。
- 运行状态：未运行、运行中、成功、警告、失败。
- 撤销、重做、历史记录。
- “运行源码”主按钮。
- “导出 `.litematic`”按钮；存在阻断错误时禁用并解释原因。
- 更多菜单：导入、复制项目、下载源码、项目设置、删除本地项目。

### 3.3 对话侧边栏

消息类型：

- 用户需求。
- AI 的简短意图说明。
- “已查询方块定义”工具卡。
- “已修改源码”差异卡，显示新增/删除行和影响方块数。
- 校验错误与自动修复过程。
- 需要用户选择时的确认卡，如尺寸、版本迁移或是否保留原结构。

对话输入支持：

- 自然语言。
- 快捷指令：`修复全部错误`、`只修改屋顶`、`把选中区域旋转 90°`。
- 当前 3D 选择自动附带上下文，例如选中 Region、方块坐标或框选体积。
- 停止生成、重新生成和从此消息建立分支。

AI 回复应优先说明结果，不在聊天里倾倒几百行代码。完整代码始终进入源码视图。

### 3.4 3D 预览

必须提供：

- 轨道旋转、平移、缩放、视角重置。
- 透视/正交视图切换。
- X/Y/Z 轴网格与原点标记。
- Region 显隐和单独着色边界。
- 按 Y 层切片，也可按 X/Z 切片。
- 透明/X-Ray、仅红石、仅非空气、仅问题方块等过滤器。
- 鼠标悬停显示坐标、方块 ID 和状态摘要。
- 单击选中方块，在检查器里展示完整状态和 NBT。
- 框选区域，把选择上下文发送给 AI。
- 错误方块以红/橙轮廓高亮，点击直接跳到诊断。
- 大结构降级策略：远处合并网格、按 chunk 懒加载、隐藏内部面。

### 3.5 源码视图

- CodeMirror 6 JavaScript 编辑器。
- 语法高亮、括号匹配、搜索、格式化、行号和诊断标记。
- 针对 Building SDK 的自动补全和悬浮文档。
- Block ID 自动补全。
- 输入 `properties` 时只显示该方块的合法属性和值。
- 点击运行后，诊断可定位源码行和具体世界坐标。
- AI 补丁以差异形式预览；默认应用，但可一键撤回。
- 保留最后一次成功运行的预览。新源码失败时不把工作区清空。

### 3.6 检查器

上下文式面板：

- 未选择方块：项目、Region、材料和性能统计。
- 选择方块：坐标、方块 ID、全部 BlockState、Block Entity NBT、来源源码行。
- 选择区域：尺寸、方块数、调色板、复制/删除/变换操作。
- 校验失败：错误代码、原因、自动修复、发送给 AI。

## 4. AI 交互设计

### 4.1 模型不是直接获得整个方块数据库

完整注册表和状态组合太大，不应全部塞进系统提示词。服务端给模型提供窄工具：

- `search_blocks(query, version, filters)`：按名称、标签、属性搜索。
- `get_block_schema(blockId, version)`：返回合法状态属性、值和默认值。
- `get_block_entity_schema(blockId, version)`：返回已知 NBT 模板和限制。
- `get_project_summary()`：尺寸、Regions、材料、源码摘要和当前选择。
- `get_source(range?)`：按需读取完整源码或局部函数。
- `validate_source(source)`：静态检查，不执行。
- `run_build(source)`：在沙箱执行并返回结构摘要与诊断。
- `apply_source_patch(patch)`：以结构化补丁修改源码。
- `inspect_blocks(query)`：按坐标、Region、方块类型或错误类型读取局部数据。

工具结果全部采用结构化 JSON；模型不通过自由文本伪造“已经修改”。

### 4.2 一次生成的状态机

```text
接收用户需求
  -> 提取版本、尺寸、风格、材料、功能约束
  -> 缺少但可合理推断的参数使用明确默认值
  -> 查询需要的方块 schema
  -> 生成源码或最小补丁
  -> 静态检查
  -> 沙箱运行
  -> BlockState/NBT/结构/红石校验
  -> 最多 3 次自动修复
  -> 成功：应用结果并刷新预览
  -> 仍失败：保留最后成功版本，向用户报告阻断项
```

### 4.3 系统提示词必须固定的事实

- 目标是 Java Edition，不使用 Bedrock block state 名称。
- 坐标约定：X 正方向为东，Y 正方向为上，Z 正方向为南。
- 所有坐标必须是整数。
- `facing`、`axis`、`half`、`shape`、`waterlogged`、`powered` 等状态在功能性结构里必须显式表达。
- 不猜方块属性；不确定时必须调用 schema 工具。
- 大结构优先使用循环与几何原语，避免逐方块输出造成 token 浪费。
- 修改已有建筑时优先最小补丁，不无故重写用户源码。
- 红石结构必须解释输入、输出、朝向、状态假设和更新风险。
- 不能声称已导出或已验证，除非对应工具成功返回。

### 4.4 上下文控制

每轮仅发送：

- 用户最近需求。
- 当前项目摘要。
- 与修改范围相关的源码片段。
- 被引用的方块 schema。
- 最近一次结构化诊断。
- 3D 当前选择与相机无关的几何上下文。

完整聊天记录压缩为决策摘要，防止长项目上下文失控。

### 4.5 模型供应商

采用 provider adapter：

- 首发支持一个 OpenAI-compatible endpoint。
- 接口层允许加入 OpenAI、Anthropic、Gemini 和本地模型。
- 只有满足可靠工具调用/结构化输出的模型才开放“自动执行”。
- 不可靠模型退化为“生成建议，等待用户确认运行”。
- 模型名称、温度、最大输出和自动修复次数进入项目设置。

## 5. JavaScript Building SDK

### 5.1 设计原则

- JavaScript 语法熟悉、可读、可手改。
- 全局只暴露冻结的 `mc` 对象和安全的标准语言能力。
- 结果必须确定性：相同源码、版本和 seed 产生完全相同结构。
- 不提供网络、DOM、文件、系统时间、动态模块和任意宿主能力。
- 几何函数最终都展开为明确方块状态，编译器不依赖宏语义。

### 5.2 建议源码形态

```js
mc.build({
  name: "Compact Comparator Lab",
  version: "26.2",
  seed: 42,
}, ({ world, block, nbt, vec }) => {
  const main = world.region("main", { origin: vec(0, 0, 0) });

  const floor = block("minecraft:stone_bricks");
  main.fill(vec(0, 0, 0), vec(10, 0, 8), floor);

  main.set(vec(2, 1, 3), block("minecraft:repeater", {
    facing: "east",
    delay: "2",
    locked: "false",
    powered: "false",
  }));

  main.set(vec(4, 1, 3), block("minecraft:comparator", {
    facing: "east",
    mode: "compare",
    powered: "false",
  }));
});
```

最终语法在实现 spike 后冻结；一旦发布，以 SDK 版本迁移，不静默破坏旧项目。

### 5.3 数据类型

```ts
type Vec3i = readonly [number, number, number]

type BlockState = {
  id: `${string}:${string}`
  properties: Readonly<Record<string, string>>
  blockEntity?: NbtCompound
}

type WorldDocument = {
  sdkVersion: string
  minecraftVersion: string
  dataVersion: number
  metadata: ProjectMetadata
  regions: RegionDocument[]
  entities: EntityDocument[]
  scheduledTicks: ScheduledTick[]
}
```

### 5.4 方块 API

- `block(id, properties?, blockEntity?)`：创建不可变方块状态。
- `block.with(state, patch)`：生成修改后的状态。
- `blocks.search()` 不在沙箱里执行；这是模型侧工具，避免运行时异步和权限扩大。
- `main.set(pos, state)`。
- `main.get(pos)`，只读取当前生成结果。
- `main.remove(pos)`，等价设置 air。
- `main.fill(from, to, state, options?)`。
- `main.replace(from, to, matcher, replacement)`。
- `main.box(from, to, state, { hollow, thickness })`。
- `main.line(from, to, state)`。
- `main.sphere(center, radius, state, { hollow })`。
- `main.cylinder(base, radius, height, state, { axis, hollow })`。
- `main.extrude(points, direction, distance, state)`。
- `main.clone(sourceBox, targetOrigin, transform?)`。
- `main.transform(box, transform)`。

所有范围采用闭区间，并在 SDK 文档和类型提示中明确。

### 5.5 变换必须同时变换状态

旋转/镜像不只是改坐标。实现需要处理：

- `facing`、`horizontal_facing`。
- `axis`。
- 0–15 的 `rotation`。
- 楼梯 `shape` 和 `half`。
- 铁轨方向与弯轨形状。
- 门的 `hinge`、`half`、朝向。
- 墙、栅栏、玻璃板、红石线的四向连接。
- 多朝向附着方块的 `face`。
- 活塞、侦测器、投掷器、漏斗等方向状态。

变换表按版本测试，不能用简单字符串替换。

### 5.6 NBT API

NBT 数字类型不能用普通 JSON 数字模糊处理，因此提供 typed builder：

```js
const commandData = nbt.compound({
  id: nbt.string("minecraft:command_block"),
  Command: nbt.string("say ready"),
  auto: nbt.byte(0),
  powered: nbt.byte(0),
  conditionMet: nbt.byte(0),
});
```

支持：

- byte、short、int、long(BigInt)、float、double。
- string、byteArray、intArray、longArray。
- list，强制同类型元素。
- compound。
- blockEntity 模板助手，例如 `nbt.chest`、`nbt.sign`、`nbt.commandBlock`。
- 原始 typed NBT 高级入口，但仍进行大小、深度和类型限制。

### 5.7 红石辅助 API

红石辅助函数是显式状态的便捷层，不是黑盒：

- `redstone.wire({ power, north, east, south, west })`。
- `redstone.repeater({ facing, delay, locked, powered })`。
- `redstone.comparator({ facing, mode, powered })`。
- `redstone.piston({ facing, extended, sticky })`。
- `redstone.observer({ facing, powered })`。
- `redstone.lever({ face, facing, powered })`。
- `redstone.button(...)`、`redstone.hopper(...)`、`redstone.rail(...)`。
- 可选网络标记：`main.net("clock-output", positions)`，便于检查器和 AI 解释，不进入最终游戏数据。

## 6. 沙箱与安全模型

### 6.1 执行方式

使用 `quickjs-emscripten` 的 WebAssembly QuickJS 运行时，并把它放在独立 Web Worker 中：

- QuickJS VM 与页面 JavaScript 全局隔离。
- 只向 VM 注入冻结的 `mc` 能力对象。
- 禁用模块加载器。
- 删除/覆盖 `eval`、`Function`、`Date` 和非确定性 `Math.random`。
- `Math.random` 替换为项目 seed 驱动的伪随机函数。
- SDK 宿主函数只接收可序列化基础类型，不把 DOM/Response/Promise 等宿主对象传入。

### 6.2 资源限制

建议初始限制：

- 单次 VM 内存 64 MiB。
- 默认执行墙钟 2 秒；高级设置最多 10 秒。
- Web Worker 另有硬超时，可直接终止。
- 最大 Region 数 64。
- 单轴尺寸默认最大 2048。
- 总体积默认最大 16,777,216。
- 非空气方块默认最大 2,000,000。
- SDK 写操作上限，避免巨量重复覆盖。
- NBT 最大深度、单字符串长度、数组长度和总字节数限制。

超限产生可供 AI 修复的结构化错误，不让页面冻结。

### 6.3 服务端安全

- LLM API Key 只在服务端环境变量。
- 请求体限制、频率限制、生成超时和 AbortSignal。
- 不把 QuickJS 执行搬到含密钥的服务端进程；默认在客户端沙箱执行。
- 严格 CSP，不允许任意远程脚本。
- 日志不记录密钥、完整 NBT 容器内容或用户未同意的源码。
- 下载文件名、Region 名和元数据做长度与字符清理。

## 7. 方块与版本数据系统

### 7.1 数据来源与构建

为每个受支持版本运行数据构建流程：

1. 从对应官方 Java Edition server/client 发行物运行 data generator。
2. 获取 blocks/registries 等 reports。
3. 生成精简 `block-manifest.json`：ID、默认状态、属性和值。
4. 提取 blockstates、models、textures、tints 和语言键，构建预览资源包。
5. 生成 Block Entity 模板和特殊渲染映射。
6. 写入 DataVersion、Litematic schema/codec 映射、资源兼容信息和内容哈希。
7. 生成与相邻版本的方块新增、删除、重命名和属性差异。
8. 执行注册表完整性、编译回读和对应版本真实加载测试。

`minecraft-data` 可作为交叉检查和部分生态数据来源，但目标版本的原始 reports 是最终真相。

### 7.2 Manifest 结构

```ts
type MinecraftVersionProfile = {
  gameVersion: string
  dataVersion: number
  supportLevel: "verified" | "compatible" | "experimental"
  litematic: {
    schemaVersion: number
    subVersion?: number
    codec: string
  }
  blocks: Record<string, {
    defaultState: Record<string, string>
    properties: Record<string, readonly string[]>
    hasBlockEntity: boolean
    renderKind: "model" | "fluid" | "special" | "invisible"
    tags: readonly string[]
  }>
  migrationFrom: Record<string, MigrationManifestRef>
  resources: {
    manifestUrl: string
    renderPackUrl?: string
    size: number
  }
  profileHash: string
}
```

### 7.3 “全部方块”的验收定义

对目标版本注册表中的每一个原版方块：

- 可被 `block(id, properties)` 引用。
- 所有合法 BlockState 组合可以通过校验。
- 非法属性和值会被拒绝并给出合法候选。
- 可以进入中间结构和 `.litematic` 调色板。
- 可在检查器中显示完整 ID/状态。
- 预览至少有明确可辨识的几何或“特殊方块占位 + 名称”表现。
- 模型型方块应按官方 blockstates/models 渲染。
- 隐形技术方块使用可切换的调试可视化。

预览像素级一致性与数据可表达性分开验收，避免因为某个特殊实体渲染器未完成而错误地禁用方块导出。

### 7.4 版本支持等级

版本选择器必须明确显示三种状态：

- **正式支持 / Verified**：注册表完整性、全部状态 schema、编译回读、关键 Block Entity、红石方向夹具和对应版本 Litematica 实际加载全部通过。
- **兼容支持 / Compatible**：已从正式发行物生成版本包，注册表和回读测试通过，但尚未完成全部真实游戏加载矩阵；允许导出，但显示兼容提示。
- **实验版本 / Experimental**：Snapshot、第三方版本包或用户自己生成的配置；不承诺完整渲染和导出兼容，必须显式确认。

不能因为某个版本号与相邻版本接近，就自动标记为正式支持。Minecraft 的小版本也可能修改数据组件、Block Entity NBT 或状态定义。

### 7.5 首批支持矩阵

| 支持线 | 计划版本 | 主要价值 | 验证重点 |
|---|---|---|---|
| Legacy | `1.12.2` | 大量经典技术服与模组包 | 数字 ID/metadata、Flattening 前格式、旧 Block Entity NBT |
| Early modern | `1.13.2`、`1.16.5` | Flattening 后早期格式、经典长期版本 | palette 状态、旧高度/方块实体格式 |
| Caves & Cliffs | `1.18.2` | 常用模组和建筑版本 | 新世界高度、负 Y、Region 坐标 |
| Wild | `1.19.2`、`1.19.4` | 常用模组服、告示牌数据变化前后 | 方块实体与实体 NBT |
| Trails | `1.20.1`、`1.20.4`、`1.20.6` | 超高使用率，覆盖 V6/V7 和 1.20.5 数据组件边界 | Litematic codec、物品/Block Entity 数据组件 |
| 1.21 family | `1.21.1`、`1.21.4`、`1.21.8`、`1.21.10`、`1.21.11` | 当前大量服务器与新方块 | 每个小版本独立 registry/profile、渲染资源 |
| Year versions | `26.1.x`、`26.2` | 当前正式版本 | 新版本号体系、最新 DataVersion、当前 Litematica V7 |

版本范围目标是最终覆盖 `1.12.2` 至当前稳定 Java Edition 的主要正式版本；首批先把上表的锚点版本做到 Verified，再通过自动流水线扩展中间 patch 版本。

### 7.6 版本包分发与缓存

版本数据分成两层，避免网页首屏携带所有版本资源：

- **Core Profile**：DataVersion、方块 ID、状态 schema、NBT/迁移规则和 codec 信息。体积较小，选择版本时下载。
- **Render Pack**：blockstates、models、纹理、tint 和特殊渲染资源。体积较大，进入 3D 预览时按需下载。

缓存规则：

- 使用 Cache Storage/IndexedDB 缓存，按 `gameVersion + profileHash` 标识。
- Profile 内容不可静默变更；hash 改变时显示更新说明。
- 项目记录创建时使用的 profileHash，旧项目仍可加载旧包或显式迁移。
- 允许用户只安装常用版本，也提供“清理版本资源”管理页。
- AI 的方块查询工具始终绑定项目 profile，不会混用最新版方块数据。

### 7.7 跨版本迁移

内部长期存储 `namespace:block_id + properties + typed NBT`，不能持久化只对某版本有效的 numeric state ID。

迁移流程：

1. 复制当前项目为迁移分支。
2. 加载来源和目标两个 VersionProfile。
3. 分类方块：完全兼容、属性变化、重命名、已删除、目标版本新增但无影响。
4. 对 BlockState 做属性级转换，不只替换方块名称。
5. 对 Block Entity/实体 NBT 使用目标版本迁移规则；无法安全转换时阻断，而不是删除字段。
6. 用户为缺失方块选择替代物；默认不自动替换为空气。
7. 重新运行结构、红石和导出校验。
8. 保存迁移报告，允许对比两版 3D 差异。

### 7.8 资源包与版权边界

- 渲染器支持用户导入合法拥有的资源包 ZIP。
- 默认资源是否随站点分发，在发布前按 Minecraft Usage Guidelines 做一次明确审核。
- 如果不分发原版纹理，则零配置模式使用清晰的程序化材质/颜色；用户导入资源包后获得精确纹理。
- 产品名称、Logo 和免责声明不得让网站看起来是 Mojang/Microsoft 官方产品。

## 8. 中间世界数据结构

### 8.1 存储策略

源码执行时使用按 16×16×16 chunk 分块的稀疏存储：

- 每个 chunk 只在首次写入时分配。
- BlockState 使用 intern 表，chunk 中存整数索引。
- 空气默认不占稀疏 Map 项。
- Block Entity、实体和计划刻单独以坐标索引。
- Region 记录原点、边界和命名，不要求内部永远是一个巨大三维数组。

导出时再为每个 Region 计算紧致边界和 palette long array。

### 8.2 冲突规则

- 后写覆盖先写。
- 每次写入记录可选 source span，诊断可以追溯到源码。
- 同一坐标写入 Block Entity 时，方块类型必须与 Block Entity 类型匹配。
- Region 重叠允许，但导出前给出警告；材料统计区分“Region 总和”和“合并世界结果”。
- Region 名必须唯一，内部保留原始显示名和安全 NBT key。

### 8.3 增量更新

完整重新运行是正确性基线。性能优化顺序：

1. 代码运行产出新的不可变 WorldDocument。
2. 按 chunk hash 与上次结果对比。
3. 只把变化 chunk 发送给渲染 Worker。
4. 材料表和诊断也按变化 chunk 更新。

不在第一版实现复杂的源码级增量执行，避免缓存错误。

## 9. `.litematic` 编译器

### 9.1 版本 codec 分派

编译器入口只接收 `WorldDocument + MinecraftVersionProfile`，再由 profile 选择对应 codec。至少预留：

- Flattening 前 Legacy codec。
- 早期 palette-based Litematic codec。
- V6 codec。
- V7 codec，以及 SubVersion/DataVersion 差异处理。

每个 codec 都要有独立 fixture；不能把 V7 根字段简单改一个版本号后声称支持旧版本。

### 9.2 现代 V7 根结构

编译器输出 GZip 压缩的大端 NBT Compound，核心字段：

- `Version`：现代文件为 7。
- `SubVersion`：当前 26.2 Litematica 分支为 1。
- `MinecraftDataVersion`：来自目标版本 profile，不使用硬编码“最新值”。
- `Metadata`：名称、作者、描述、时间、RegionCount、TotalBlocks、TotalVolume、EnclosingSize，可选预览图。
- `Regions`：以 Region 名为 key 的 Compound。

每个 Region 包含：

- `Position`。
- `Size`。
- `BlockStatePalette`。
- `BlockStates` long array。
- `TileEntities`。
- `Entities`。
- `PendingBlockTicks`。
- `PendingFluidTicks`。

具体可选字段以目标 Litematica 源码和金样为准，不依赖第三方博客猜测。

### 9.3 调色板和索引

- Palette 0 固定为 `minecraft:air`，便于默认填充。
- 状态 key 使用 `namespace:id` 加按字典序排序的 properties。
- `bitsPerEntry = max(2, ceil(log2(paletteSize)))`。
- 线性索引：`index = y * (sizeX * sizeZ) + z * sizeX + x`。
- entry 可跨越两个 64 位 long，必须正确处理边界。
- JavaScript 使用 `BigInt` 做 64 位运算，再按 NBT signed long 的二补码写入。
- 不把数字经过 IEEE-754 Number，从而避免高位精度丢失。

### 9.4 元数据计算

- `TotalBlocks`：非空气方块数量。
- `TotalVolume`：按 Litematica 目标版本语义计算并用金样验证。
- `EnclosingSize`：所有 Region 的包围盒尺寸。
- 时间字段使用毫秒 Unix epoch long。
- 导出时的作者和描述来自项目设置，不由模型偷偷替换。

### 9.5 Block Entity 与实体

- 坐标写入 Region 相对位置，严格按目标 schema。
- NBT 保留明确数值类型。
- V6/V7 在 1.20.5 数据组件大改边界分开编码。
- 不能支持的跨版本 NBT 作为阻断错误，不静默删除。
- 实体和计划刻在首个 UI 可以隐藏，但编译器数据模型从一开始保留。

### 9.6 导出前强制回读

```text
WorldDocument
  -> encode NBT
  -> gzip
  -> 立即 gunzip + parse
  -> schema check
  -> palette/坐标/计数 round-trip comparison
  -> 通过后才触发浏览器下载
```

## 10. 3D 渲染架构

### 10.1 推荐方案

- 用 `deepslate` 处理 Minecraft 结构、blockstates/models 和任意资源包。
- 把结构数据适配为渲染器需要的 block state 表示。
- 渲染/meshing 放入 Worker 或分批调度，主线程只负责交互。
- 选择、Region 边界、网格和诊断高亮作为独立 overlay 层。

选择它的理由：它面向 TypeScript，能够渲染结构，且已有加载任意资源包的路径。`prismarine-viewer` 可作为 spike 对照，但其版本支持和 chunk 世界模型与本产品的结构编辑场景需要额外适配。

### 10.2 特殊渲染

按优先级实现：

1. 普通方块模型、multipart、随机 variant、透明与 tint。
2. 流体和 waterlogged。
3. 红石线、铁轨、门、栅栏、墙等状态驱动模型。
4. 箱子、末影箱、潜影盒、床、告示牌、旗帜、头颅等 Block Entity 特殊渲染。
5. 隐形技术方块调试图标。

特殊渲染器未完成时必须有明确占位，不允许“方块在导出里存在但预览中完全消失且无提示”。

### 10.3 性能目标

在主流桌面浏览器的合理硬件上设定工程目标：

- 10 万非空气方块首次预览不超过约 2 秒。
- 25 万方块仍能流畅旋转，交互目标 30 FPS 以上。
- 100 万方块允许进入“分层/按 chunk/简化材质”模式。
- 代码执行和导出期间 UI 可响应，可取消。
- 大文件解析、gzip、bit packing 和 meshing 都不在主线程长时间阻塞。

这些是性能预算，最终以基准机器和真实夹具测量后调整。

## 11. 校验系统

### 11.1 诊断统一格式

```ts
type Diagnostic = {
  severity: "error" | "warning" | "info"
  stage: "syntax" | "runtime" | "block-state" | "nbt" | "structure" | "redstone" | "export"
  code: string
  message: string
  source?: { from: number; to: number; line: number; column: number }
  block?: { region: string; x: number; y: number; z: number }
  suggestion?: string
}
```

### 11.2 BlockState 校验

- 未知方块 ID。
- 当前版本不存在的方块。
- 未知属性。
- 非法属性值。
- 缺失属性时补默认值，并在功能性方块上给提示。
- 技术方块、空气变种和不可获取方块给信息级提示。

### 11.3 NBT 校验

- NBT 类型、深度、大小。
- Block Entity 与方块类型匹配。
- 必填 ID/坐标字段由编译器统一生成，避免模型重复写错。
- 容器物品列表、槽位和 Count 范围。
- 告示牌/命令方块等版本差异。
- 发现未知高级字段时保留，但标记“未做语义验证”。

### 11.4 结构校验

- 重叠 Region。
- 超出项目限制。
- 浮空依附方块、门上下半缺失、床头尾不匹配。
- 双箱、活塞头/基座、Tall Plant 等多方块一致性。
- 水浸状态与方块能力。
- 旋转后连接状态不一致。

### 11.5 红石静态校验

至少覆盖：

- 红石线四向连接是否与邻居几何一致。
- repeater/comparator 的朝向、延迟、模式、locked/powered 合法性。
- 侦测器输出方向与观察方向。
- 活塞伸出状态与活塞头一致性。
- 拉杆/按钮/火把等依附面存在。
- 漏斗朝向和启用状态。
- 铁轨形状与相邻轨道。
- 常见零刻/准连接结构标记为“版本敏感”，不擅自改写。
- 计划刻存在时检查目标方块和延迟。

静态校验不强行把所有 `powered` 改成根据邻居推导的值，因为 schematic 可能有意保存瞬时状态。

## 12. 持久化与项目历史

MVP 使用 IndexedDB：

- 项目元数据。
- 当前源码。
- 最后成功的 WorldDocument 或其压缩快照。
- 对话摘要和最近消息。
- 运行诊断。
- 用户导入的资源包索引。
- 历史版本，以源码 patch + 周期性快照存储。

原则：

- 默认本地优先，不上传建筑文件。
- 聊天请求只发送模型所需的最小上下文。
- 可导出完整项目包，便于备份和迁移。
- 账号与云同步以后再加，不让登录阻塞核心工具。

## 13. 建议技术栈

- React + TypeScript。
- Vite/vinext 站点结构，部署目标兼容 Cloudflare Worker。
- Vercel AI SDK：多模型适配、流式消息和工具调用。
- Zod：工具参数和 API 边界校验。
- CodeMirror 6：源码编辑器。
- quickjs-emscripten：不可信 JavaScript 沙箱。
- deepslate：Minecraft 结构/资源模型渲染 spike 首选。
- prismarine-nbt 或独立最小 NBT writer：格式 spike 后择一；无论选择哪个，都用金样锁定输出。
- fflate 或浏览器 CompressionStream：GZip。
- IndexedDB + `idb`：本地项目存储。
- Vitest：核心单元与属性测试。
- 浏览器端 E2E：关键用户流程。

依赖选择原则：先完成 format/render/sandbox 三个 spike，再冻结依赖；不因为某个包“名字像能用”就把核心格式正确性交给未验证的封装。

## 14. 测试策略

### 14.1 编译器单元测试

- Palette 大小 1、2、4、5、8、9、16、17 等 bit 宽度边界。
- 跨 64 位 entry。
- 最高位为 1 的 signed long。
- X/Y/Z 索引顺序。
- 空气 index 0。
- 正负 Region 原点和尺寸。
- 多 Region 包围盒与计数。
- 所有 NBT 基础类型。
- GZip round-trip。

### 14.2 金样测试

至少保存这些由真实 Litematica 生成的 fixture：

- 单石块。
- 每轴不同方块的 2×2×2 方向夹具，用来发现坐标转置。
- 5/9/17 个 palette entry，覆盖 bit packing 扩容。
- 楼梯、门、铁轨、墙、红石线的全部关键状态。
- 箱子、告示牌、命令方块 Block Entity。
- 多 Region、负坐标。
- Legacy/1.12.2、早期 palette/1.16.5、V6/1.20.4、V7/1.20.6 和当前 26.2 各一组。

测试：真实文件 -> 解析 -> 中间结构 -> 再编码 -> 语义等价；以及 JS -> 编码 -> Litematica 实际加载。

### 14.3 沙箱测试

- 无限循环被中断。
- 大内存分配被拒绝。
- `fetch`、DOM、文件、模块导入不可用。
- 尝试从 SDK 原型逃逸失败。
- 同 seed 输出稳定。
- Worker 超时后 UI 恢复。

### 14.4 方块注册表测试

- Profile 中方块数与原始 registry report 一致。
- 每个默认状态合法。
- 每个属性值能编码/解码。
- 每个方块至少有一种预览表现。
- 随机抽取状态经过 `.litematic` round-trip 不变。
- 每个 Verified profile 都必须独立运行，不能只用最新版测试结果代替旧版本。
- 相邻版本 diff 必须能识别新增、删除、属性变化和默认状态变化。
- Core Profile 与 Render Pack 的 hash、缓存和旧项目锁定行为需要测试。

### 14.5 版本迁移测试

- 同方块、同属性的无损迁移。
- 方块重命名和属性枚举变化。
- 来源版本存在、目标版本不存在的方块。
- 1.12.2 -> 1.13.2 Flattening 边界。
- 1.20.4 -> 1.20.6 V6/V7 与数据组件边界。
- 1.21.11 -> 26.x 新版本号与反混淆边界。
- Block Entity NBT 无法转换时必须阻断并保留原项目。
- 迁移后材料表、红石状态和 `.litematic` 回读一致。

### 14.6 红石夹具

- 单向 repeater 链。
- comparator 比较/减法模式。
- 观察者脉冲链。
- 活塞门小型结构。
- 漏斗时钟。
- 物品分类器核心单元。
- 铁轨转向与 powered rail。

验证方向、延迟、锁定、powered、连接、附着和 Block Entity 数据。高精度阶段再加入真实游戏加载测试。

### 14.7 E2E

- 新建项目 -> 对话生成 -> 自动修复 -> 预览 -> 导出。
- 手改源码产生错误 -> 定位行 -> 修复 -> 保留历史。
- 选择一个 3D 区域 -> 对话局部修改。
- 导入 `.litematic` -> 查看状态/NBT -> 修改 -> 再导出。
- 切换版本 -> 显示迁移报告 -> 用户确认。
- 离线重开 -> IndexedDB 恢复。

## 15. 验收标准

首个多版本完整版本只有同时满足以下条件才算完成：

1. 首批矩阵中每个标记为 Verified 的 Minecraft 版本，其 registry 全部原版方块都可表达、校验和导出。
2. 任一方块合法 BlockState 不会因字符串简化而丢失。
3. Block Entity NBT 保留类型并能回读。
4. 测试 `.litematic` 可被对应版本 Litematica 实际加载。
5. 方向夹具证明 X/Y/Z 没有转置。
6. bit packing 边界测试全部通过。
7. 至少一个 repeater/comparator/observer/piston 组合结构状态完全正确。
8. AI 不查询 schema 时产生的非法状态会被拦截并自动修复。
9. 无限循环和内存炸弹不会冻结页面。
10. 用户可在对话、3D 和源码三者之间建立明确对应关系。
11. 导出前回读校验失败时绝不下载“看似成功”的文件。
12. 大结构达到基准性能，超限时有可解释的降级而不是崩溃。
13. VersionProfile 和渲染资源按需加载；未安装版本不会拖慢首屏。
14. 版本选择器不会把 Compatible/Experimental 冒充为 Verified。
15. 跨版本迁移在替换或丢失方块前必须获得用户明确确认，并保留来源项目。
16. 同一份 AI 代码运行时只读取项目锁定的版本数据，不出现跨版本方块污染。

## 16. 实施路线与关卡

### 阶段 0：三个技术 Spike

并行验证但顺序验收：

1. **格式 Spike**：为 `1.12.2`、`1.16.5`、`1.20.4`、`1.20.6`、`26.2` 建立参考文件，识别实际 codec 边界；导出单块/方向/palette 边界文件，并让对应版本真实 Litematica 加载。
2. **渲染 Spike**：同一份 WorldDocument 在浏览器展示 100+ 状态敏感方块，验证资源包和特殊方块策略。
3. **沙箱 Spike**：QuickJS 注入最小 `mc` API，验证时间、内存、权限和确定性。

只有三个 spike 都通过才搭完整 UI。

### 阶段 1：核心领域层

- VersionProfile registry、版本包安装/缓存、支持等级和方块 manifest 构建器。
- BlockState/NBT 类型。
- chunked WorldDocument。
- Building SDK 基础几何。
- 结构化诊断。
- 版本 codec 分派、Legacy/早期 palette/V6/V7 编译器、解析器和回读。
- 全部单元/金样测试。

### 阶段 2：预览与编辑工作台

- 3D 渲染、chunk 增量、切片、选择、错误高亮。
- CodeMirror、SDK 自动补全、源码诊断。
- 检查器、材料表、Region 面板。
- IndexedDB 与历史记录。

### 阶段 3：AI 对话闭环

- 流式聊天。
- 方块 schema 查询工具。
- 源码补丁工具。
- 静态检查、执行、验证、最多三次自动修复。
- 选择上下文和源码/世界坐标映射。

### 阶段 4：红石精度与导入导出

- 红石 helper 和静态规则。
- Block Entity 模板。
- `.litematic` 导入。
- 多版本 codec、版本迁移报告和差异预览。
- 真实 Litematica 加载回归矩阵。

### 阶段 5：发布质量

- 性能基准与大结构降级。
- 安全测试、CSP、频率和大小限制。
- 资源版权/品牌审核。
- 完整帮助、示例项目和错误恢复。
- 部署与最终端到端验证。

## 17. 关键风险和应对

| 风险 | 后果 | 应对 |
|---|---|---|
| Litematic 非正式稳定规范 | 新版本文件加载失败 | 以当前源码 + 真实金样 + 游戏加载三重验证 |
| DataVersion 与 NBT 版本漂移 | 方块实体或实体丢数据 | Project 锁版本；V6/V7 分离；不静默转换 |
| 支持版本过多导致包体膨胀 | 首屏慢、缓存占用大 | Core Profile/Render Pack 分离，按需安装和 hash 缓存 |
| 小版本被误认为完全兼容 | 生成不存在的方块状态 | 每个版本独立 profile；Verified/Compatible/Experimental 分级 |
| 跨版本自动替换造成建筑损坏 | 方块或红石语义丢失 | 迁移分支、逐项报告、用户选择替代物、禁止默认替换空气 |
| 浏览器预览与游戏不一致 | 用户误判朝向/连接 | 状态检查器为真相；方向夹具；特殊渲染占位明确 |
| 任意 JS 逃逸或死循环 | 安全和可用性事故 | QuickJS WASM + Worker + 能力白名单 + 硬限制 |
| 大模型幻觉属性名 | 无法导出或红石错误 | schema 工具 + 强校验 + 自动修复闭环 |
| 大建筑内存/mesh 过大 | 页面卡死 | chunk 稀疏存储、Worker、内部面裁剪、分层模式 |
| 完整原版纹理分发边界 | 发布风险 | 资源包导入；发布前按官方 Usage Guidelines 审核 |
| 红石依赖更新顺序 | 静态状态正确但粘贴后行为变化 | 标记版本敏感结构；提供本地真实游戏验证器路线 |
| 模型每次重写全文 | 用户修改丢失、成本高 | 源码最小 patch、历史记录、最后成功版本保护 |

## 18. 规划阶段需要最终确认的产品决策

开始实现前只需要确认以下几项；若不确认，可按推荐值推进：

1. **首批版本矩阵**：默认采用文档中的 14 个常用锚点版本，并把 `1.12.2/1.13.2` 放入 Legacy 支持线。
2. **默认新建版本**：推荐当前稳定版；版本选择器同时突出 `1.20.1`、`1.21.1` 等长期常用版本。
3. **模型接入**：推荐先实现 OpenAI-compatible 服务端配置，再加多供应商 UI。
4. **资源纹理**：推荐首版支持用户导入资源包，同时做一个合法、明确的零配置预览方案。
5. **部署方式**：推荐先本地优先 + 可部署站点；项目默认只存浏览器 IndexedDB。
6. **红石验证深度**：推荐首版静态高精度，随后增加本地 Fabric 验证器。

## 19. 技术依据

- 当前 Minecraft Java Edition 26.2 已正式发布：<https://www.minecraft.net/da-dk/article/minecraft-java-edition-26-2>
- 当前 Litematica 26.2 源码与发布：<https://github.com/sakura-ryoko/litematica/tree/26.2>
- 当前源码中的 Litematic V7/SubVersion 1：<https://github.com/sakura-ryoko/litematica/blob/26.2/src/main/java/fi/dy/masa/litematica/schematic/LitematicaSchematic.java>
- Litematica bit array 与跨 long 打包实现：<https://github.com/sakura-ryoko/litematica/blob/26.2/src/main/java/fi/dy/masa/litematica/schematic/container/LitematicaBitArray.java>
- Litematica 坐标索引和最少 2 bit 规则：<https://github.com/sakura-ryoko/litematica/blob/26.2/src/main/java/fi/dy/masa/litematica/schematic/container/LitematicaBlockStateContainer.java>
- Litematic 的 metadata/region/坐标概览：<https://litemapy.readthedocs.io/en/latest/litematics.html>
- Minecraft 数据与注册表生态数据：<https://github.com/PrismarineJS/minecraft-data>
- 浏览器 Minecraft 结构渲染候选：<https://github.com/misode/deepslate>
- QuickJS WASM 沙箱及时间/内存限制：<https://github.com/justjake/quickjs-emscripten>
- Minecraft Usage Guidelines：<https://www.minecraft.net/nl-nl/usage-guidelines>
