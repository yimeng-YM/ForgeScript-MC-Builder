import { generateText } from "ai";
import { z } from "zod";
import {
  DEFAULT_MODEL_SETTINGS,
  modelSettingsSchema,
} from "@/lib/ai/model-settings";
import { publicModelError, resolveModel } from "@/lib/ai/provider";

export const runtime = "edge";

const requestSchema = z.object({
  settings: modelSettingsSchema.default(DEFAULT_MODEL_SETTINGS),
});

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

    const result = await generateText({
      model: resolved.model,
      system: "这是连接测试。不要使用工具，只回复 OK。",
      prompt: "回复 OK",
      maxOutputTokens: 16,
      maxRetries: 0,
      timeout: Math.min(settings.generation.timeoutMs, 30_000),
      temperature: 0,
    });

    return Response.json({
      ok: true,
      mode: "remote",
      label: resolved.label,
      latencyMs: Date.now() - startedAt,
      message: result.text.trim().slice(0, 80) || "连接成功",
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

