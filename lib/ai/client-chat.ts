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

function builderInstructions(version: string, source: string | undefined, settings: ModelSettings) {
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

## 常见错误避免
1. fill/hollowBox/walls/line 的 from 和 to 参数必须是 [x, y, z] 数组，不能传其他格式
2. region.set 的第一个参数必须是 [x, y, z] 数组
3. block() 的第一个参数必须是带命名空间的字符串，如 "minecraft:stone"
4. 所有坐标值必须是整数，不能是浮点数
5. 不要调用不存在的方法，只使用上述列出的 API

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
    const previousCommit = latestCommitOutput(messages);
    const shouldFinalize = previousCommit?.accepted === true || previousCommit?.terminal === true;
    const requiredToolChoice = requiredClientToolChoice(settings);
    const agent = new ToolLoopAgent({
      model: resolved.model,
      instructions: `${builderInstructions(version, source, settings)}\n${shouldFinalize
        ? "浏览器已返回终止性的 commit_source 结果。不得再次调用工具；准确总结验证成功或未收敛失败。"
        : "本轮必须以调用 commit_source 并提交完整候选源码结束。"}`,
      tools: { commit_source: commitSourceTool },
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
