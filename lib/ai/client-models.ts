import { generateText, tool } from "ai";
import { z } from "zod";
import { inferVisionCapability, type ModelSettings } from "./model-settings.ts";
import {
  assertClientBaseURL,
  clientDiscoveryHeaders,
  clientReasoning,
  publicClientModelError,
  requiredClientToolChoice,
  resolveClientModel,
  resolvedClientApiKey,
  shouldUseClientStrictToolSchema,
} from "./client-provider.ts";

export type CatalogModel = {
  id: string;
  name: string;
  vision: boolean;
  provider?: string;
};

export type ClientConnectionResult = {
  ok: true;
  mode: "local" | "remote";
  label: string;
  latencyMs: number;
  message: string;
};

function modelsURL(baseURL: string) {
  const normalized = assertClientBaseURL(baseURL);
  return normalized.endsWith("/models") ? normalized : `${normalized}/models`;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function normalizedClientCatalog(payload: unknown): CatalogModel[] {
  const root = jsonRecord(payload);
  const rawModels = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : [];
  const seen = new Set<string>();

  return rawModels.flatMap((raw): CatalogModel[] => {
    const entry = jsonRecord(raw);
    const rawId = typeof entry.id === "string"
      ? entry.id
      : typeof entry.name === "string"
        ? entry.name
        : "";
    const id = rawId.replace(/^models\//, "").trim();
    if (!id || seen.has(id) || /(embedding|rerank|moderation|whisper|tts)/i.test(id)) return [];
    seen.add(id);
    const name = typeof entry.display_name === "string"
      ? entry.display_name
      : typeof entry.displayName === "string"
        ? entry.displayName
        : typeof entry.name === "string" && !entry.name.startsWith("models/")
          ? entry.name
          : id;
    return [{
      id,
      name,
      vision: inferVisionCapability(id),
      provider: typeof entry.owned_by === "string" ? entry.owned_by : undefined,
    }];
  }).slice(0, 500);
}

async function fetchCatalog(url: string, headers: Record<string, string>) {
  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`模型目录浏览器直连失败：${reason}`);
  }
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = jsonRecord(payload).error;
    const message = typeof error === "string"
      ? error
      : typeof jsonRecord(error).message === "string"
        ? String(jsonRecord(error).message)
        : `模型目录请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return normalizedClientCatalog(payload);
}

export async function fetchClientModelCatalog(settings: ModelSettings) {
  try {
    if (settings.provider === "auto" && !resolvedClientApiKey(settings)) {
      return {
        source: "浏览器本地演示",
        models: [{ id: settings.model, name: "本地演示生成器", vision: false }],
      };
    }

    if (settings.provider === "auto" || settings.provider === "gateway") {
      const apiKey = resolvedClientApiKey(settings);
      if (!apiKey) throw new Error("AI Gateway 缺少 API Key");
      const { createGateway } = await import("ai");
      const result = await createGateway({ apiKey }).getAvailableModels();
      return {
        source: "AI Gateway",
        models: result.models
          .filter((model) => !model.modelType || model.modelType === "language")
          .map((model) => ({
            id: model.id,
            name: model.name || model.id,
            vision: inferVisionCapability(model.id),
            provider: model.specification.provider,
          }))
          .slice(0, 500),
      };
    }

    const headers = clientDiscoveryHeaders(settings);
    let url: string;
    if (settings.provider === "google") {
      url = modelsURL(settings.baseURL || "https://generativelanguage.googleapis.com/v1beta");
      const apiKey = resolvedClientApiKey(settings);
      if (!apiKey) throw new Error("Google Gemini 缺少 API Key");
      const parsedURL = new URL(url);
      parsedURL.searchParams.set("key", apiKey);
      url = parsedURL.toString();
    } else if (settings.provider === "anthropic") {
      url = modelsURL(settings.baseURL || "https://api.anthropic.com/v1");
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    } else {
      url = modelsURL(settings.baseURL);
    }

    const models = await fetchCatalog(url, headers);
    if (models.length === 0) throw new Error("供应商返回了空模型目录");
    return { source: settings.providerName, models };
  } catch (error) {
    throw new Error(publicClientModelError(error, settings.apiKey));
  }
}

const connectionTestInputSchema = z.object({ ok: z.boolean() });

function createConnectionTestTool(settings: ModelSettings) {
  return tool({
    description: "确认当前模型可以执行 ForgeScript 所需的工具调用。",
    inputSchema: connectionTestInputSchema,
    ...(shouldUseClientStrictToolSchema(settings) ? { strict: true } : {}),
  });
}

export async function testClientModelConnection(settings: ModelSettings): Promise<ClientConnectionResult> {
  const startedAt = performance.now();
  try {
    const resolved = resolveClientModel(settings);
    if (resolved.mode === "local" || !resolved.model) {
      return {
        ok: true,
        mode: "local",
        label: resolved.label,
        latencyMs: Math.round(performance.now() - startedAt),
        message: "未填写远程密钥，当前使用浏览器本地演示生成器。",
      };
    }

    const toolChoice = requiredClientToolChoice(settings);
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
      reasoning: clientReasoning(settings),
    });

    if (!result.toolCalls.some((call) => (
      call.toolName === "connection_test"
      && connectionTestInputSchema.safeParse(call.input).data?.ok === true
    ))) {
      throw new Error("模型连接正常，但没有完成 ForgeScript 必需的工具调用");
    }

    return {
      ok: true,
      mode: "remote",
      label: resolved.label,
      latencyMs: Math.round(performance.now() - startedAt),
      message: "浏览器直连与工具调用均成功",
    };
  } catch (error) {
    throw new Error(publicClientModelError(error, settings.apiKey));
  }
}
