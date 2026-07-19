import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  createGateway,
  extractReasoningMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";
import type { ModelSettings } from "./model-settings.ts";

const FORBIDDEN_HEADERS = new Set([
  "access-control-allow-origin",
  "connection",
  "content-length",
  "cookie",
  "host",
  "origin",
  "proxy-authorization",
  "referer",
  "set-cookie",
  "transfer-encoding",
  "upgrade",
]);

export type ClientResolvedModel = {
  mode: "local" | "remote";
  model?: LanguageModel;
  label: string;
};

function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".localhost")) return true;
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return Boolean(match && Number(match[1]) === 127);
}

export function assertClientBaseURL(rawURL: string) {
  let url: URL;
  try {
    url = new URL(rawURL);
  } catch {
    throw new Error("Base URL 不是有效的网址");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("Base URL 不能包含账号、密码或片段");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error("Base URL 必须使用 HTTPS；Ollama、LM Studio 等本机回环地址可使用 HTTP");
  }
  return url.toString().replace(/\/$/, "");
}

export function safeClientHeaders(settings: ModelSettings, apiKey: string) {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(settings.customHeaders)) {
    const normalized = name.trim().toLowerCase();
    if (!normalized || normalized.startsWith("sec-") || FORBIDDEN_HEADERS.has(normalized)) continue;
    headers[name.trim()] = value;
  }
  if (apiKey && settings.authMode === "api-key") headers["api-key"] = apiKey;
  if (apiKey && settings.authMode === "x-api-key") headers["x-api-key"] = apiKey;
  return headers;
}

export function resolvedClientApiKey(settings: ModelSettings) {
  return settings.apiKey.trim();
}

export function clientDiscoveryHeaders(settings: ModelSettings) {
  const apiKey = resolvedClientApiKey(settings);
  const headers = safeClientHeaders(settings, apiKey);
  if (apiKey && settings.authMode === "bearer") headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function isDeepSeekConfiguration(settings: ModelSettings) {
  return (
    settings.presetId === "deepseek"
    || /deepseek/i.test(settings.providerName)
    || /api\.deepseek\.com/i.test(settings.baseURL)
    || /^deepseek-(?:chat|reasoner)$/i.test(settings.model)
  );
}

export function clientReasoning(settings: ModelSettings) {
  // DeepSeek 官方接口不接受 reasoning_effort 参数，必须完全省略；
  // "none" 在 OpenAI 兼容层会被自动剥离，在 Anthropic/Google 原生层则真正关闭思考。
  if (isDeepSeekConfiguration(settings)) return undefined;
  if (settings.generation.reasoningEffort === "off") return "none" as const;
  return settings.generation.reasoningEffort;
}

export function shouldUseClientStrictToolSchema(settings: ModelSettings) {
  if (!isDeepSeekConfiguration(settings)) return true;
  try {
    return new URL(settings.baseURL).pathname.replace(/\/$/, "").endsWith("/beta");
  } catch {
    return false;
  }
}

export function requiredClientToolChoice(settings: ModelSettings) {
  return isDeepSeekConfiguration(settings) ? undefined : "required" as const;
}

function browserFetch(providerName: string): typeof fetch {
  return async (input, init) => {
    try {
      return await fetch(input, init);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${providerName} 浏览器直连失败：${reason}`);
    }
  };
}

export function resolveClientModel(settings: ModelSettings): ClientResolvedModel {
  const apiKey = resolvedClientApiKey(settings);

  if (settings.provider === "auto") {
    if (!apiKey) return { mode: "local", label: "浏览器本地演示生成器" };
    const gateway = createGateway({ apiKey });
    return { mode: "remote", model: gateway(settings.model), label: `AI Gateway · ${settings.model}` };
  }

  if (settings.provider === "gateway") {
    if (!apiKey) throw new Error("AI Gateway 缺少 API Key；浏览器直连不会读取服务器环境变量");
    const gateway = createGateway({ apiKey });
    return { mode: "remote", model: gateway(settings.model), label: `AI Gateway · ${settings.model}` };
  }

  if (settings.provider === "anthropic") {
    if (!apiKey) throw new Error("Anthropic 缺少 API Key");
    const baseURL = settings.baseURL ? assertClientBaseURL(settings.baseURL) : undefined;
    const anthropic = createAnthropic({
      apiKey,
      baseURL,
      headers: {
        ...safeClientHeaders(settings, ""),
        "anthropic-dangerous-direct-browser-access": "true",
      },
      fetch: browserFetch("Anthropic"),
    });
    return { mode: "remote", model: anthropic(settings.model), label: `Anthropic · ${settings.model}` };
  }

  if (settings.provider === "google") {
    if (!apiKey) throw new Error("Google Gemini 缺少 API Key");
    const baseURL = settings.baseURL ? assertClientBaseURL(settings.baseURL) : undefined;
    const google = createGoogleGenerativeAI({
      apiKey,
      baseURL,
      headers: safeClientHeaders(settings, ""),
      fetch: browserFetch("Google Gemini"),
    });
    return { mode: "remote", model: google(settings.model), label: `Google · ${settings.model}` };
  }

  const baseURL = assertClientBaseURL(settings.baseURL);
  if (!apiKey && settings.authMode !== "none") {
    throw new Error(`${settings.providerName} 缺少 API Key`);
  }
  const providerName = settings.providerName.replace(/[^a-zA-Z0-9]/g, "") || "customProvider";
  const compatible = createOpenAICompatible({
    name: providerName,
    baseURL,
    apiKey: settings.authMode === "bearer" ? apiKey || undefined : undefined,
    headers: safeClientHeaders(settings, apiKey),
    includeUsage: true,
    fetch: browserFetch(settings.providerName),
  });
  return {
    mode: "remote",
    model: wrapLanguageModel({
      model: compatible.chatModel(settings.model),
      // Ollama、LM Studio 等本地服务把思维链放在正文 <think> 标签里，
      // 而不是 reasoning_content 字段；抽取后正文与推理摘要才能分流。
      middleware: extractReasoningMiddleware({ tagName: "think", startWithReasoning: true }),
    }),
    label: `${settings.providerName} · ${settings.model}`,
  };
}

export function publicClientModelError(error: unknown, apiKey = "") {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutSecret = apiKey ? raw.split(apiKey).join("[已隐藏]") : raw;
  const looksLikeBrowserNetworkFailure = /(failed to fetch|load failed|networkerror|browser direct|浏览器直连失败)/i.test(withoutSecret);
  if (looksLikeBrowserNetworkFailure) {
    return `${withoutSecret}\n该供应商可能未允许浏览器跨域直连（CORS），或浏览器拦截了混合内容。请在供应商控制台允许当前网页 Origin，或改用支持浏览器直连的接口。`.slice(0, 1_500);
  }
  return withoutSecret.slice(0, 1_500);
}
