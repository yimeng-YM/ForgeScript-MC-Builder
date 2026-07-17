import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { sourceForPrompt } from "@/lib/minecraft/demo-source";

export const runtime = "edge";

const requestSchema = z.object({
  messages: z.array(z.custom<UIMessage>()),
  version: z.string().default("1.21.11"),
  source: z.string().max(80_000).optional(),
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
          "已在**本地建筑模式**中完成结构脚本，并交给受控沙箱运行。配置 AI Gateway 后，同一个对话入口会切换为真实大模型与工具调用。",
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

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid chat request" }, { status: 400 });
  }
  const { messages, version, source } = parsed.data;
  const hasGateway = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
  if (!hasGateway) return localResponse(messages, version);

  const modelMessages = await convertToModelMessages(messages);
  const result = streamText({
    model: process.env.LLM_MODEL ?? "openai/gpt-5.4",
    messages: modelMessages,
    instructions: `你是 Minecraft Java Edition 建筑工程师。当前目标版本是 ${version}。
你只能生成受控 Building SDK 源码，不得使用 fetch、DOM、文件、模块导入或计时器。
坐标约定为 X 东、Y 上、Z 南。功能方块必须显式写出 facing、axis、half、shape、powered、locked、delay 等关键状态。
可用 API：mc.build(metadata, ({ world, block }) => { const region = world.region(name, {origin}); region.set/fill/hollowBox/walls/line/pillar/replace(...) })。
完成后必须调用 commit_source 提交完整 JavaScript；聊天正文只简要说明结果和精度假设，不粘贴源码。
当前源码如下，可按用户要求最小修改：
${source ?? "// empty project"}`,
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
    stopWhen: stepCountIs(4),
  });

  return result.toUIMessageStreamResponse({ originalMessages: messages });
}

