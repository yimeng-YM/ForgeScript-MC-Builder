import { createGateway } from "ai";
import { z } from "zod";
import {
  DEFAULT_MODEL_SETTINGS,
  inferVisionCapability,
  modelSettingsSchema,
} from "@/lib/ai/model-settings";
import {
  assertSafeBaseURL,
  modelDiscoveryHeaders,
  publicModelError,
  resolvedApiKey,
} from "@/lib/ai/provider";

export const runtime = "edge";

const requestSchema = z.object({
  settings: modelSettingsSchema.default(DEFAULT_MODEL_SETTINGS),
});

type CatalogModel = {
  id: string;
  name: string;
  vision: boolean;
  provider?: string;
};

function modelsURL(baseURL: string) {
  const normalized = assertSafeBaseURL(baseURL);
  return normalized.endsWith("/models") ? normalized : `${normalized}/models`;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizedCatalog(payload: unknown): CatalogModel[] {
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
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
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
  return normalizedCatalog(payload);
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "模型配置无效" }, { status: 400 });
  const { settings } = parsed.data;

  try {
    if (settings.provider === "auto" || settings.provider === "gateway") {
      const apiKey = resolvedApiKey(settings);
      const gateway = createGateway(apiKey ? { apiKey } : undefined);
      const result = await gateway.getAvailableModels();
      const models = result.models
        .filter((model) => !model.modelType || model.modelType === "language")
        .map((model) => ({
          id: model.id,
          name: model.name || model.id,
          vision: inferVisionCapability(model.id),
          provider: model.specification.provider,
        }))
        .slice(0, 500);
      return Response.json({ ok: true, source: "AI Gateway", models });
    }

    const headers = modelDiscoveryHeaders(settings);
    let url: string;
    if (settings.provider === "google") {
      const baseURL = settings.baseURL || "https://generativelanguage.googleapis.com/v1beta";
      url = modelsURL(baseURL);
      const apiKey = resolvedApiKey(settings);
      if (!apiKey) throw new Error("Google Gemini 缺少 API Key");
      const parsedURL = new URL(url);
      parsedURL.searchParams.set("key", apiKey);
      url = parsedURL.toString();
    } else if (settings.provider === "anthropic") {
      url = modelsURL(settings.baseURL || "https://api.anthropic.com/v1");
      headers["anthropic-version"] = "2023-06-01";
    } else {
      url = modelsURL(settings.baseURL);
    }

    const models = await fetchCatalog(url, headers);
    if (models.length === 0) throw new Error("供应商返回了空模型目录");
    return Response.json({ ok: true, source: settings.providerName, models });
  } catch (error) {
    return Response.json(
      { error: publicModelError(error, settings.apiKey) },
      { status: 400 },
    );
  }
}
