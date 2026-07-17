import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  DEFAULT_MODEL_SETTINGS,
  modelSettingsSchema,
  type ModelSettings,
} from "@/lib/ai/model-settings";
import { publicModelError, resolveModel } from "@/lib/ai/provider";
import { sourceForPrompt } from "@/lib/minecraft/demo-source";

export const runtime = "edge";

const requestSchema = z.object({
  messages: z.array(z.custom<UIMessage>()),
  version: z.string().default("1.21.11"),
  source: z.string().max(80_000).optional(),
  settings: modelSettingsSchema.default(DEFAULT_MODEL_SETTINGS),
});

function getLatestPrompt(messages: UIMessage[]): string {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  if (!latest) return "生成一座小型 Minecraft 建筑";
  return latest.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function localResponse(messages: UIMessage[], version: string) {
  const prompt = getLatestPrompt(messages);
  const source = sourceForPrompt(prompt, version);
  const toolCallId = `local-${crypto.randomUUID()}`;
  const textId = `text-${crypto.randomUUID()}`;
  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: ({ writer }) => {
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
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: { accepted: true, sourceLength: source.length },
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
  const extra = settings.builder.extraInstructions.trim()
    ? `\n用户的额外生成偏好：\n${settings.builder.extraInstructions.trim()}`
    : "";

  return `你是 Minecraft Java Edition 建筑工程师。当前目标版本是 ${version}。
你只能生成受控 Building SDK 源码，不得使用 fetch、DOM、文件、模块导入或计时器。
坐标约定为 X 东、Y 上、Z 南。${detailInstruction(settings)}
${stateRule}
${redstoneRule}
${editRule}
结构不得超过 ${settings.builder.maxBuildBlocks.toLocaleString("en-US")} 个方块。
可用 API：mc.build(metadata, ({ world, block }) => { const region = world.region(name, {origin}); region.set/fill/hollowBox/walls/line/pillar/replace(...) })。
完成后必须调用 commit_source 提交完整 JavaScript；聊天正文只简要说明结果、精度假设和需要用户注意的限制，不粘贴源码。
当前源码如下：
${source ?? "// empty project"}${extra}`;
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid chat request" }, { status: 400 });
  }
  const { messages, version, source, settings } = parsed.data;
  let resolved;
  try {
    resolved = resolveModel(settings);
  } catch (error) {
    return Response.json(
      { error: publicModelError(error, settings.apiKey) },
      { status: 400 },
    );
  }
  if (resolved.mode === "local" || !resolved.model) return localResponse(messages, version);

  const modelMessages = await convertToModelMessages(messages);
  const result = streamText({
    model: resolved.model,
    messages: modelMessages,
    instructions: builderInstructions(version, source, settings),
    temperature: settings.generation.topP === null ? settings.generation.temperature ?? undefined : undefined,
    topP: settings.generation.topP ?? undefined,
    maxOutputTokens: settings.generation.maxOutputTokens,
    maxRetries: settings.generation.maxRetries,
    timeout: settings.generation.timeoutMs,
    seed: settings.generation.seed ?? undefined,
    tools: {
      commit_source: {
        description: "提交可在受控 Building SDK 沙箱中运行的完整 JavaScript 源码",
        inputSchema: z.object({
          source: z.string().max(80_000),
          summary: z.string().max(500),
          version: z.string(),
        }),
        execute: async ({ source: nextSource, summary }) => ({
          accepted: true,
          sourceLength: nextSource.length,
          summary,
        }),
      },
    },
    stopWhen: stepCountIs(settings.generation.maxSteps),
  });

  return result.toUIMessageStreamResponse({ originalMessages: messages });
}
