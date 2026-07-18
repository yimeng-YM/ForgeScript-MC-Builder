import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  streamText,
  tool,
  type FileUIPart,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  DEFAULT_MODEL_SETTINGS,
  modelSettingsSchema,
  type ModelSettings,
} from "@/lib/ai/model-settings";
import {
  commitSourceInputSchema,
  commitSourceOutputSchema,
  latestCommitOutput,
  type BuilderUIMessage,
} from "@/lib/ai/agent-protocol";
import {
  publicModelError,
  requiredToolChoice,
  resolveModel,
  shouldUseStrictToolSchema,
} from "@/lib/ai/provider";
import { sourceForPrompt } from "@/lib/minecraft/demo-source";

export const runtime = "edge";

const requestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(100),
  version: z.string().min(1).max(40).default("1.21.11"),
  source: z.string().max(80_000).optional(),
  settings: modelSettingsSchema.default(DEFAULT_MODEL_SETTINGS),
});

function createCommitSourceTool(settings: ModelSettings) {
  return tool({
    description: "提交完整 JavaScript，由浏览器执行 AST 预检、QuickJS 沙箱和版本方块注册表校验；失败时根据结果继续修正。",
    inputSchema: commitSourceInputSchema,
    outputSchema: commitSourceOutputSchema,
    ...(shouldUseStrictToolSchema(settings) ? { strict: true } : {}),
  });
}

function getLatestPrompt(messages: UIMessage[]): string {
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

function localFinalResponse(messages: UIMessage[], accepted: boolean, error?: string) {
  const textId = `text-${crypto.randomUUID()}`;
  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id: textId });
      writer.write({
        type: "text-delta",
        id: textId,
        delta: accepted
          ? "本地演示生成已通过 AST 预检、QuickJS 沙箱与当前版本方块注册表校验。"
          : `本地演示生成未通过完整校验，且本地生成器不具备模型修正能力。${error ? `\n\n${error}` : ""}`,
      });
      writer.write({ type: "text-end", id: textId });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

function localResponse(messages: UIMessage[], version: string) {
  const latestResult = latestCommitOutput(messages);
  if (latestResult) return localFinalResponse(messages, latestResult.accepted, latestResult.error);
  const prompt = getLatestPrompt(messages);
  const source = sourceForPrompt(prompt, version);
  const toolCallId = `local-${crypto.randomUUID()}`;
  const textId = `text-${crypto.randomUUID()}`;
  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id: textId });
      writer.write({
        type: "text-delta",
        id: textId,
        delta:
          "已在**本地演示生成器**中完成结构脚本，并交给受控沙箱运行。你可以从顶部的模型设置切换到 AI Gateway、原生供应商或任意 OpenAI 兼容接口。",
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
  return createUIMessageStreamResponse({ stream });
}

function detailInstruction(settings: ModelSettings) {
  if (settings.builder.detailLevel === "concept") {
    return "先保证轮廓、比例和主材正确，允许减少非关键装饰。";
  }
  if (settings.builder.detailLevel === "balanced") {
    return "兼顾建筑外观、内部空间和合理的方块数量。";
  }
  return "按工程级精度生成：处理连接、转角、内部结构、功能状态与可施工性。";
}

function builderInstructions(version: string, source: string | undefined, settings: ModelSettings) {
  const stateRule = settings.builder.strictBlockStates
    ? "所有带状态方块必须显式写出该版本所需属性，不能依赖含糊默认值。"
    : "优先显式写出关键方块状态。";
  const redstoneRule = settings.builder.redstonePrecision
    ? "红石结构必须逐方块推导信号方向、强度、延迟、准连接与更新顺序；中继器、比较器、活塞、观察者、漏斗和容器必须写全状态。"
    : "红石部件需要写明关键朝向和工作状态。";
  const editRule = settings.builder.preserveExisting
    ? "保留与需求无关的现有源码，只做满足本轮要求所需的最小修改。"
    : "可以重构或重建现有源码，以当前需求的整体质量为优先。";
  const redstoneSemantics = [
    "CRITICAL JAVA REDSTONE SEMANTICS:",
    "redstone wire topology is resolved automatically from final neighboring blocks; create dust with redstone.wire(power).",
    "For repeaters and comparators, the Java block-state `facing` points from OUTPUT toward INPUT, so signal travel is the opposite direction.",
    "Always prefer redstone.repeater(signalDirection, { delay, locked, powered }) and redstone.comparator(signalDirection, { mode, powered }); these helpers accept the SIGNAL TRAVEL direction and write the opposite facing value.",
    "Example: a signal travelling east (+X) requires facing=west, so use redstone.repeater(\"east\", { delay: 2 }).",
    "The build callback API is ({ world, block, redstone }).",
  ].join(" ");
  const blockNameSafetyRule = [
    "CRITICAL BLOCK ID & NAMESPACE RULES:",
    "1. Every block ID passed to block() or region methods (set, fill, hollowBox, walls, replace, etc.) MUST be prefix-complete with its namespace, e.g., use 'minecraft:stone' instead of 'stone', use 'minecraft:spruce_planks' instead of 'spruce_planks'. Never omit the 'minecraft:' prefix.",
    "2. Ensure you use the correct block ID names for the target Minecraft Java version: " + version + ".",
    "   - For 1.13+, use flattened IDs (e.g. 'minecraft:oak_sign' instead of 'minecraft:sign', 'minecraft:oak_planks' instead of 'minecraft:planks').",
    "   - For 1.12.2 and older, use legacy IDs if required, or follow standard legacy names.",
    "   - Double-check that block IDs generated actually exist in Java " + version + "."
  ].join(" ");
  const extra = settings.builder.extraInstructions.trim()
    ? `\n用户的额外生成偏好：\n${settings.builder.extraInstructions.trim()}`
    : "";
  const agentLoopRule = [
    "AGENT TOOL LOOP:",
    "commit_source is executed by the browser and performs both AST security preflight and real QuickJS plus Minecraft registry validation.",
    "If accepted=false and terminal is not true, read the exact error, repair the complete source, and call commit_source again.",
    "If accepted=true, do not call commit_source again; provide a concise final summary.",
    "If terminal=true, do not call commit_source again; clearly report that the run did not converge.",
  ].join(" ");

  return `你是 Minecraft Java Edition 建筑工程师，也是一个会使用工具验证自己工作的 Agent。当前目标版本是 ${version}。
你只能生成受控 Building SDK 源码，不得使用 fetch、DOM、文件、模块导入或计时器。
坐标约定为 X 东、Y 上、Z 南。${detailInstruction(settings)}
${stateRule}
${redstoneRule}
${redstoneSemantics}
${blockNameSafetyRule}
${editRule}
结构不得超过 ${settings.builder.maxBuildBlocks.toLocaleString("en-US")} 个方块。
可用 API：
mc.build(metadata, ({ world, block, redstone }) => {
  const region = world.region(name, {origin: [x,y,z]});
  // API 签名说明：坐标/位置/范围参数（[x,y,z] 数组）必须作为前方的参数传入，方块状态参数（如 block(...) 或 ID 字符串）放在最后。
  region.set([x, y, z], blockState)
  region.fill([x1, y1, z1], [x2, y2, z2], blockState)
  region.hollowBox([x1, y1, z1], [x2, y2, z2], blockState)
  region.walls([x1, y1, z1], [x2, y2, z2], blockState)
  region.line([x1, y1, z1], [x2, y2, z2], blockState)
  region.pillar([x, y, z], height, blockState)
  region.replace([x1, y1, z1], [x2, y2, z2], matchId, blockState)
})。
完成后必须调用 commit_source 提交完整 JavaScript。commit_source 会在浏览器中依次进行 AST 安全预检、QuickJS 隔离执行和目标版本方块注册表校验；如果返回 accepted=false 且 terminal 不是 true，你必须阅读错误、修改完整源码并再次调用。只有 accepted=true 才代表完整验证通过；terminal=true 表示本次运行已经停止，不得继续调用工具。聊天正文只简要说明结果、验证结果、精度假设和需要用户注意的限制，不粘贴源码。不要输出私有思维链；只提供简洁、可核验的推理摘要和工具执行轨迹。
${agentLoopRule}
当前源码如下：
${source ?? "// empty project"}${extra}`;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 48 * 1024 * 1024) {
    return Response.json({ error: "Chat request is too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid chat request" }, { status: 400 });
  }
  const { version, source, settings } = parsed.data;
  const commitSourceTool = createCommitSourceTool(settings);
  const toolChoice = requiredToolChoice(settings);
  const validated = await safeValidateUIMessages<BuilderUIMessage>({
    messages: parsed.data.messages,
    tools: { commit_source: commitSourceTool },
  });
  if (!validated.success) {
    return Response.json({ error: "Invalid UI message history" }, { status: 400 });
  }
  const messages = validated.data;
  const totalTextLength = messages.reduce(
    (total, message) => total + message.parts.reduce(
      (messageTotal, part) => messageTotal + (part.type === "text" ? part.text.length : 0),
      0,
    ),
    0,
  );
  if (totalTextLength > 500_000) {
    return Response.json({ error: "Chat text history is too large" }, { status: 413 });
  }
  const inputError = imageInputError(messages, settings.capabilities.vision);
  if (inputError) return Response.json({ error: inputError }, { status: 400 });
  let resolved;
  try {
    resolved = resolveModel(settings);
  } catch (error) {
    return Response.json(
      { error: publicModelError(error, settings.apiKey) },
      { status: 400 },
    );
  }
  if (resolved.mode === "local" || !resolved.model) {
    const hasImages = messages.some((message) => message.parts.some((part) => part.type === "file"));
    if (hasImages) {
      return Response.json({ error: "本地演示生成器不支持图片，请连接支持视觉输入的远程模型" }, { status: 400 });
    }
    return localResponse(messages, version);
  }

  const previousCommit = latestCommitOutput(messages);
  const shouldFinalize = previousCommit?.accepted === true || previousCommit?.terminal === true;
  const modelMessages = await convertToModelMessages(messages, {
    tools: { commit_source: commitSourceTool },
  });
  const result = streamText({
    model: resolved.model,
    messages: modelMessages,
    instructions: `${builderInstructions(version, source, settings)}\n${shouldFinalize
      ? "The browser has returned a terminal commit_source result. Do not call tools. Summarize the verified success or non-convergent failure accurately."
      : "You must finish this turn by calling commit_source with the complete candidate source."}`,
    temperature: settings.generation.topP === null ? settings.generation.temperature ?? undefined : undefined,
    topP: settings.generation.topP ?? undefined,
    maxOutputTokens: settings.generation.maxOutputTokens,
    maxRetries: settings.generation.maxRetries,
    timeout: { totalMs: settings.generation.timeoutMs },
    abortSignal: request.signal,
    seed: settings.generation.seed ?? undefined,
    reasoning: settings.generation.reasoningEffort === "off"
      ? undefined
      : settings.generation.reasoningEffort,
    ...(shouldFinalize ? {} : {
      tools: { commit_source: commitSourceTool },
      ...(toolChoice ? { toolChoice } : {}),
    }),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onError: (error) => publicModelError(error, settings.apiKey),
  });
}
