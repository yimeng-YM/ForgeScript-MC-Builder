import {
  createAgentUIStream,
  createUIMessageStream,
  tool,
  ToolLoopAgent,
  type ChatTransport,
  type FileUIPart,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { z } from "zod";
import {
  commitSourceInputSchema,
  commitSourceOutputSchema,
  readSourceInputSchema,
  readSourceOutputSchema,
  searchSourceInputSchema,
  searchSourceOutputSchema,
  editSourceInputSchema,
  editSourceOutputSchema,
  latestCommitOutput,
  type BuilderUIMessage,
} from "./agent-protocol.ts";
import { DEFAULT_MODEL_SETTINGS, modelSettingsSchema, type ModelSettings } from "./model-settings.ts";
import {
  clientReasoning,
  publicClientModelError,
  requiredClientToolChoice,
  resolveClientModel,
  shouldUseClientStrictToolSchema,
} from "./client-provider.ts";
import { sourceForPrompt } from "../minecraft/demo-source.ts";
import { detectModules, buildKnowledgeModules } from "./prompt-modules.ts";

const transportBodySchema = z.object({
  version: z.string().min(1).max(40).default("1.21.11"),
  source: z.string().max(80_000).optional(),
  settings: modelSettingsSchema.default(DEFAULT_MODEL_SETTINGS),
});

function createCommitSourceTool(settings: ModelSettings) {
  return tool({
    description: "提交完整 JavaScript，由浏览器执行 AST 预检、QuickJS 沙箱和 Minecraft 版本注册表校验；失败时根据结果继续修正。",
    inputSchema: commitSourceInputSchema,
    outputSchema: commitSourceOutputSchema,
    ...(shouldUseClientStrictToolSchema(settings) ? { strict: true } : {}),
  });
}


function createReadSourceTool(getSource: () => string, settings: ModelSettings) {
  return tool({
    description: "读取当前源码内容。可指定行号范围读取部分内容，默认读取全部源码。用于查看现有代码结构。",
    inputSchema: readSourceInputSchema,
    outputSchema: readSourceOutputSchema,
    ...(shouldUseClientStrictToolSchema(settings) ? { strict: true } : {}),
    execute: async (input) => {
      const source = getSource();
      const lines = source.split("\n");
      const totalLines = lines.length;
      const lineStart = Math.max(1, Math.min(input.lineStart ?? 1, totalLines));
      const lineEnd = Math.max(lineStart, Math.min(input.lineEnd ?? totalLines, totalLines));
      const selectedLines = lines.slice(lineStart - 1, lineEnd);
      return {
        source: selectedLines.join("\n"),
        totalLines,
        returnedLines: selectedLines.length,
        lineStart,
        lineEnd,
      };
    },
  });
}

function createSearchSourceTool(getSource: () => string, settings: ModelSettings) {
  return tool({
    description: "在当前源码中搜索关键词或正则表达式。返回匹配行号、内容和上下文。用于快速定位代码片段。",
    inputSchema: searchSourceInputSchema,
    outputSchema: searchSourceOutputSchema,
    ...(shouldUseClientStrictToolSchema(settings) ? { strict: true } : {}),
    execute: async (input) => {
      const source = getSource();
      const lines = source.split("\n");
      const matches: Array<{ lineNumber: number; line: string; context?: string[] }> = [];
      let regex: RegExp;
      try {
        regex = input.isRegex
          ? new RegExp(input.query, "g")
          : new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\function latestPrompt(messages: UIMessage[]) {"), "g");
      } catch {
        return { matches: [], totalMatches: 0, query: input.query };
      }
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const ctx: string[] = [];
          const cl = input.contextLines ?? 2;
          for (let j = Math.max(0, i - cl); j < i; j++) ctx.push(`${j + 1}: ${lines[j]}`);
          for (let j = i + 1; j <= Math.min(lines.length - 1, i + cl); j++) ctx.push(`${j + 1}: ${lines[j]}`);
          matches.push({ lineNumber: i + 1, line: lines[i], context: ctx.length > 0 ? ctx : undefined });
          regex.lastIndex = 0;
        }
      }
      return { matches, totalMatches: matches.length, query: input.query };
    },
  });
}

function createEditSourceTool(getSource: () => string, setSource: (s: string) => void, settings: ModelSettings) {
  return tool({
    description: "对当前源码进行增量编辑。支持 insert/replace/delete 三种操作，可一次执行多个。用于分步修改代码，避免一次性重写全部源码。",
    inputSchema: editSourceInputSchema,
    outputSchema: editSourceOutputSchema,
    ...(shouldUseClientStrictToolSchema(settings) ? { strict: true } : {}),
    execute: async (input) => {
      const source = getSource();
      const lines = source.split("\n");
      let newLines = [...lines];
      let operationsApplied = 0;
      const sorted = [...input.operations].sort((a, b) => b.lineStart - a.lineStart);
      for (const op of sorted) {
        try {
          if (op.type === "insert") {
            const idx = Math.max(0, Math.min(op.lineStart - 1, newLines.length));
            newLines.splice(idx, 0, ...(op.content ?? "").split("\n"));
            operationsApplied++;
          } else if (op.type === "replace") {
            if (!op.lineEnd) return { accepted: false, error: "replace 操作需要 lineEnd 参数", operationsApplied, totalOperations: input.operations.length };
            const s = Math.max(0, Math.min(op.lineStart - 1, newLines.length));
            const e = Math.max(s, Math.min(op.lineEnd, newLines.length));
            newLines.splice(s, e - s, ...(op.content ?? "").split("\n"));
            operationsApplied++;
          } else if (op.type === "delete") {
            if (!op.lineEnd) return { accepted: false, error: "delete 操作需要 lineEnd 参数", operationsApplied, totalOperations: input.operations.length };
            const s = Math.max(0, Math.min(op.lineStart - 1, newLines.length));
            const e = Math.max(s, Math.min(op.lineEnd, newLines.length));
            newLines.splice(s, e - s);
            operationsApplied++;
          }
        } catch (err) {
          return { accepted: false, error: `操作执行失败: ${err instanceof Error ? err.message : String(err)}`, operationsApplied, totalOperations: input.operations.length };
        }
      }
      const newSource = newLines.join("\n");
      if (newSource.length > 80_000) return { accepted: false, error: "编辑后源码超过 80KB 限制", operationsApplied, totalOperations: input.operations.length };
      setSource(newSource);
      return { accepted: true, newSource, operationsApplied, totalOperations: input.operations.length };
    },
  });
}

function latestPrompt(messages: UIMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  if (!latest) return "生成一座小型 Minecraft 建筑";
  return latest.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function imageInputError(messages: UIMessage[], visionEnabled: boolean) {
  const imageParts = messages.flatMap((message) =>
    message.parts.filter((part): part is FileUIPart =>
      part.type === "file" && part.mediaType.startsWith("image/"),
    ),
  );
  if (imageParts.length === 0) return "";
  if (!visionEnabled) return "当前模型配置未启用视觉输入，请在模型设置中开启后再上传图片";
  if (imageParts.length > 12) return "单次对话最多保留 12 张参考图片";
  for (const part of imageParts) {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(part.url)) {
      return "图片必须是 PNG、JPEG、WebP 或 GIF 本地上传内容";
    }
    if (part.url.length > 12_000_000) return "单张图片不能超过 8 MB";
  }
  return "";
}

function localFinalStream(messages: BuilderUIMessage[], accepted: boolean, error?: string) {
  const textId = `text-${crypto.randomUUID()}`;
  return createUIMessageStream<BuilderUIMessage>({
    originalMessages: messages,
    execute: ({ writer }) => {
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id: textId });
      writer.write({
        type: "text-delta",
        id: textId,
        delta: accepted
          ? "浏览器本地演示生成已通过 AST 预检、QuickJS 沙箱与当前版本方块注册表校验。"
          : `浏览器本地演示生成未通过完整校验，且演示生成器不具备模型修正能力。${error ? `\n\n${error}` : ""}`,
      });
      writer.write({ type: "text-end", id: textId });
    },
  });
}

function localStream(messages: BuilderUIMessage[], version: string) {
  const latestResult = latestCommitOutput(messages);
  if (latestResult) return localFinalStream(messages, latestResult.accepted, latestResult.error);
  const source = sourceForPrompt(latestPrompt(messages), version);
  const toolCallId = `local-${crypto.randomUUID()}`;
  const textId = `text-${crypto.randomUUID()}`;
  return createUIMessageStream<BuilderUIMessage>({
    originalMessages: messages,
    execute: ({ writer }) => {
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id: textId });
      writer.write({
        type: "text-delta",
        id: textId,
        delta: "已在浏览器本地演示生成器中完成结构脚本，并交给受控沙箱运行。填写供应商 API Key 后可直接连接远程模型。",
      });
      writer.write({ type: "text-end", id: textId });
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "commit_source",
        input: { source, summary: "生成完整建筑源码", version },
      });
    },
  });
}

function detailInstruction(settings: ModelSettings) {
  if (settings.builder.detailLevel === "concept") return "优先保证轮廓、比例和主材料正确，可减少非关键装饰。";
  if (settings.builder.detailLevel === "balanced") return "兼顾建筑外观、内部空间和合理的方块数量。";
  return "按工程级精度生成，处理连接、转角、内部结构、功能状态与可施工性。";
}

function builderInstructions(version: string, source: string | undefined, settings: ModelSettings, extraModules: string = "") {
  const stateRule = settings.builder.strictBlockStates
    ? "所有带状态方块必须显式写出该版本所需属性，不能依赖含糊默认值。"
    : "优先显式写出关键方块状态。";
  const redstoneRule = settings.builder.redstonePrecision
    ? "红石结构必须推导信号方向、强度、延迟、准连接与更新顺序，并写全关键部件状态。"
    : "红石部件需要写明关键朝向和工作状态。";
  const editRule = settings.builder.preserveExisting
    ? "保留与需求无关的现有源码，只做满足本轮需求所需的最小修改。"
    : "可以重构现有源码，以当前需求的整体质量为优先。";
  const extra = settings.builder.extraInstructions.trim()
    ? `\n用户的额外生成偏好：\n${settings.builder.extraInstructions.trim()}`
    : "";

  return `你是 Minecraft Java Edition 建筑工程师和会使用验证工具的 Agent。目标版本是 ${version}。
只生成受控 Building SDK JavaScript，不得使用 fetch、DOM、文件、模块导入或计时器。坐标约定：X 东、Y 上、Z 南。
${detailInstruction(settings)} ${stateRule} ${redstoneRule} ${editRule}
结构不得超过 ${settings.builder.maxBuildBlocks.toLocaleString("en-US")} 个方块。

## 关键 API 用法（必须严格遵守）

### 坐标格式
所有坐标必须是 [x, y, z] 整数数组，不能是对象或其他格式。例如：
- 正确: [0, 0, 0], [5, 3, -2]
- 错误: {x: 0, y: 0, z: 0}, "0,0,0"

### 区域创建
const region = world.region("名称", { origin: [0, 0, 0] });

### 放置方块
region.set([x, y, z], block("minecraft:stone"))

### 填充区域（两个角点必须都是 [x,y,z] 数组）
region.fill([x1, y1, z1], [x2, y2, z2], block("minecraft:stone"))

### 空心盒子
region.hollowBox([x1, y1, z1], [x2, y2, z2], block("minecraft:stone"))

### 墙壁（只有四面墙，不含顶底）
region.walls([x1, y1, z1], [x2, y2, z2], block("minecraft:stone"))

### 直线
region.line([x1, y1, z1], [x2, y2, z2], block("minecraft:stone"))

### 柱子
region.pillar([x, y, z], height, block("minecraft:stone"))

### 方块 ID 规则
每个传入 block() 的方块 ID 都必须包含命名空间，例如 minecraft:stone，并确保 ID 存在于 Java ${version}。

### 构建入口
mc.build({ name: "名称", version: "${version}", author: "作者", description: "描述" }, ({ world, block, redstone }) => {
  // 使用 world.region 与 region API
});

### Java 红石语义
中继器和比较器的 block-state facing 从输出指向输入，与信号传播方向相反；优先使用 redstone.repeater(signalDirection, options) 和 redstone.comparator(signalDirection, options)。

${extraModules}

## 常见错误避免
1. fill/hollowBox/walls/line 的 from 和 to 参数必须是 [x, y, z] 数组，不能传其他格式
2. region.set 的第一个参数必须是 [x, y, z] 数组
3. block() 的第一个参数必须是带命名空间的字符串，如 "minecraft:stone"
4. 所有坐标值必须是整数，不能是浮点数
5. 不要调用不存在的方法，只使用上述列出的 API



## 增量编辑（推荐用于大型建筑）
对于大型建筑，推荐使用增量编辑方式分步构建：
1. 先用 commit_source 提交基础结构（如地基、主体框架）
2. 使用 read_source 查看现有代码结构
3. 使用 search_source 定位需要修改的代码位置
4. 使用 edit_source 进行增量修改（如添加装饰、内部细节）
5. 最终用 commit_source 提交完整版本进行验证

增量编辑的优势：
- 避免一次性生成大量代码导致的 token 限制问题
- 可以逐步完善建筑细节
- 更容易定位和修复错误
- 支持迭代式开发

完成后必须调用 commit_source 提交完整 JavaScript。工具在当前浏览器内执行 AST 安全预检、QuickJS 隔离执行和目标版本注册表校验。
若 accepted=false 且 terminal 不为 true，必须读取准确错误、修复完整源码并再次提交；accepted=true 后停止调用工具并简要总结；terminal=true 后不得继续调用工具。
不要输出私有思维链，只提供简洁、可核验的摘要和工具轨迹。
当前源码：
${source ?? "// empty project"}${extra}`;
}

class ClientBuilderChatTransport implements ChatTransport<BuilderUIMessage> {
  async sendMessages(options: Parameters<ChatTransport<BuilderUIMessage>["sendMessages"]>[0]): Promise<ReadableStream<UIMessageChunk>> {
    const parsedBody = transportBodySchema.safeParse(options.body ?? {});
    if (!parsedBody.success) throw new Error("浏览器直连请求中的版本、源码或模型配置无效");
    const { version, source, settings } = parsedBody.data;
    const messages = options.messages;
    const textLength = messages.reduce(
      (total, message) => total + message.parts.reduce(
        (messageTotal, part) => messageTotal + (part.type === "text" ? part.text.length : 0),
        0,
      ),
      0,
    );
    if (textLength > 500_000) throw new Error("对话文本历史过长，请开始新绘画后重试");
    const inputError = imageInputError(messages, settings.capabilities.vision);
    if (inputError) throw new Error(inputError);

    let resolved;
    try {
      resolved = resolveClientModel(settings);
    } catch (error) {
      throw new Error(publicClientModelError(error, settings.apiKey));
    }
    if (resolved.mode === "local" || !resolved.model) {
      if (messages.some((message) => message.parts.some((part) => part.type === "file"))) {
        throw new Error("浏览器本地演示生成器不支持图片，请连接支持视觉输入的远程模型");
      }
      return localStream(messages, version);
    }

    const commitSourceTool = createCommitSourceTool(settings);

    // 创建增量编辑工具（维护当前源码状态）
    let currentSource = source ?? "";
    const readSourceTool = createReadSourceTool(() => currentSource, settings);
    const searchSourceTool = createSearchSourceTool(() => currentSource, settings);
    const editSourceTool = createEditSourceTool(
      () => currentSource,
      (newSource: string) => { currentSource = newSource; },
      settings
    );

    const previousCommit = latestCommitOutput(messages);
    const shouldFinalize = previousCommit?.accepted === true || previousCommit?.terminal === true;
    const requiredToolChoice = requiredClientToolChoice(settings);
    const agent = new ToolLoopAgent({
      model: resolved.model,
      instructions: `${builderInstructions(version, source, settings, buildKnowledgeModules(detectModules(latestPrompt(messages), source, { redstoneCircuitModule: settings.builder.redstoneCircuitModule })))}\n${shouldFinalize
        ? "浏览器已返回终止性的 commit_source 结果。不得再次调用工具；准确总结验证成功或未收敛失败。"
        : "本轮必须以调用 commit_source 并提交完整候选源码结束。"}`,
      tools: {
        commit_source: commitSourceTool,
        read_source: readSourceTool,
        search_source: searchSourceTool,
        edit_source: editSourceTool,
      },
      toolChoice: shouldFinalize ? "none" : requiredToolChoice,
      temperature: settings.generation.topP === null ? settings.generation.temperature ?? undefined : undefined,
      topP: settings.generation.topP ?? undefined,
      maxOutputTokens: settings.generation.maxOutputTokens,
      maxRetries: settings.generation.maxRetries,
      timeout: { totalMs: settings.generation.timeoutMs },
      seed: settings.generation.seed ?? undefined,
      reasoning: clientReasoning(settings),
    });

    try {
      return await createAgentUIStream({
        agent,
        uiMessages: messages,
        abortSignal: options.abortSignal,
        sendReasoning: true,
        onError: (error) => publicClientModelError(error, settings.apiKey),
      }) as ReadableStream<UIMessageChunk>;
    } catch (error) {
      throw new Error(publicClientModelError(error, settings.apiKey));
    }
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}

export const clientBuilderTransport = new ClientBuilderChatTransport();
