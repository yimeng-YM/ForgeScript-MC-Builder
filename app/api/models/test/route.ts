import { generateText, tool } from "ai";
import { z } from "zod";
import {
  DEFAULT_MODEL_SETTINGS,
  modelSettingsSchema,
} from "@/lib/ai/model-settings";
import {
  publicModelError,
  requiredToolChoice,
  resolveModel,
  shouldUseStrictToolSchema,
} from "@/lib/ai/provider";

export const runtime = "edge";

const requestSchema = z.object({
  settings: modelSettingsSchema.default(DEFAULT_MODEL_SETTINGS),
});
const connectionTestInputSchema = z.object({ ok: z.boolean() });

function createConnectionTestTool(settings: z.infer<typeof modelSettingsSchema>) {
  return tool({
    description: "确认当前模型可以执行 ForgeScript 所需的工具调用。",
    inputSchema: connectionTestInputSchema,
    ...(shouldUseStrictToolSchema(settings) ? { strict: true } : {}),
  });
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ ok: false, error: "模型配置格式无效" }, { status: 400 });
  }

  const { settings } = parsed.data;
  const startedAt = Date.now();
  try {
    const resolved = resolveModel(settings);
    if (resolved.mode === "local" || !resolved.model) {
      return Response.json({
        ok: true,
        mode: "local",
        label: resolved.label,
        latencyMs: Date.now() - startedAt,
        message: "服务器尚未配置云端模型，当前会使用本地演示生成器。",
      });
    }
    const toolChoice = requiredToolChoice(settings);

    const result = await generateText({
      model: resolved.model,
      system: "这是 ForgeScript 连接测试。必须调用 connection_test 工具，并将 ok 设为 true。",
      prompt: "执行连接测试工具。",
      tools: { connection_test: createConnectionTestTool(settings) },
      ...(toolChoice ? { toolChoice } : {}),
      maxOutputTokens: 256,
      maxRetries: 0,
      timeout: Math.min(settings.generation.timeoutMs, 30_000),
      temperature: settings.generation.topP === null ? 0 : undefined,
      topP: settings.generation.topP ?? undefined,
      reasoning: settings.generation.reasoningEffort === "off"
        ? undefined
        : settings.generation.reasoningEffort,
    });

    if (!result.toolCalls.some((call) => (
      call.toolName === "connection_test"
      && connectionTestInputSchema.safeParse(call.input).data?.ok === true
    ))) {
      throw new Error("模型连接正常，但没有完成 ForgeScript 必需的工具调用");
    }

    return Response.json({
      ok: true,
      mode: "remote",
      label: resolved.label,
      latencyMs: Date.now() - startedAt,
      message: "连接与工具调用均成功",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: publicModelError(error, settings.apiKey),
      },
      { status: 502 },
    );
  }
}
