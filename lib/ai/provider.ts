import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway, type LanguageModel } from "ai";
import type { ModelSettings } from "./model-settings";

const FORBIDDEN_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "set-cookie",
  "transfer-encoding",
  "upgrade",
]);

export type ResolvedModel = {
  mode: "local" | "remote";
  model?: LanguageModel;
  label: string;
};

function serverKeyFor(settings: ModelSettings) {
  if (settings.provider === "gateway" || settings.provider === "auto") {
    return process.env.AI_GATEWAY_API_KEY ?? "";
  }
  if (settings.provider === "anthropic") return process.env.ANTHROPIC_API_KEY ?? "";
  if (settings.provider === "google") {
    return process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
  }
  const envByPreset: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    siliconflow: process.env.SILICONFLOW_API_KEY,
    moonshot: process.env.MOONSHOT_API_KEY,
    dashscope: process.env.DASHSCOPE_API_KEY,
    zhipu: process.env.ZHIPU_API_KEY,
  };
  return envByPreset[settings.presetId] ?? "";
}

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function assertSafeBaseURL(rawURL: string) {
  let url: URL;
  try {
    url = new URL(rawURL);
  } catch {
    throw new Error("Base URL 不是有效的网址");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("Base URL 不能包含账号、密码或片段");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLocal = hostname === "localhost" || hostname === "::1" || hostname.endsWith(".localhost");
  if (process.env.NODE_ENV === "production") {
    const isPrivateIpv6 = hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80:");
    if (isLocal || hostname.endsWith(".local") || isPrivateIpv4(hostname) || isPrivateIpv6) {
      throw new Error("托管环境不允许访问本机或私有网络地址");
    }
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal && process.env.NODE_ENV !== "production")) {
    throw new Error("Base URL 必须使用 HTTPS；本地开发可使用 localhost HTTP");
  }
  return url.toString().replace(/\/$/, "");
}

function safeHeaders(settings: ModelSettings, apiKey: string) {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(settings.customHeaders)) {
    const normalized = name.trim().toLowerCase();
    if (!normalized || FORBIDDEN_HEADERS.has(normalized)) continue;
    headers[name.trim()] = value;
  }
  if (apiKey && settings.authMode === "api-key") headers["api-key"] = apiKey;
  if (apiKey && settings.authMode === "x-api-key") headers["x-api-key"] = apiKey;
  return headers;
}

export function resolveModel(settings: ModelSettings): ResolvedModel {
  const suppliedKey = settings.apiKey.trim();
  const serverKey = serverKeyFor(settings);
  const apiKey = suppliedKey || serverKey;

  if (settings.provider === "auto") {
    const modelId = process.env.LLM_MODEL ?? settings.model;
    const hasGatewayAuth = Boolean(apiKey || process.env.VERCEL_OIDC_TOKEN);
    if (!hasGatewayAuth) return { mode: "local", label: "本地演示生成器" };
    if (suppliedKey) {
      const gateway = createGateway({ apiKey: suppliedKey });
      return { mode: "remote", model: gateway(modelId), label: `AI Gateway · ${modelId}` };
    }
    return { mode: "remote", model: modelId, label: `AI Gateway · ${modelId}` };
  }

  if (settings.provider === "gateway") {
    if (!apiKey && !process.env.VERCEL_OIDC_TOKEN) throw new Error("AI Gateway 缺少 API Key 或服务器 OIDC 配置");
    if (suppliedKey || serverKey) {
      const gateway = createGateway({ apiKey });
      return { mode: "remote", model: gateway(settings.model), label: `AI Gateway · ${settings.model}` };
    }
    return { mode: "remote", model: settings.model, label: `AI Gateway · ${settings.model}` };
  }

  if (settings.provider === "anthropic") {
    if (!apiKey) throw new Error("Anthropic 缺少 API Key");
    const baseURL = settings.baseURL ? assertSafeBaseURL(settings.baseURL) : undefined;
    const anthropic = createAnthropic({ apiKey, baseURL, headers: safeHeaders(settings, "") });
    return { mode: "remote", model: anthropic(settings.model), label: `Anthropic · ${settings.model}` };
  }

  if (settings.provider === "google") {
    if (!apiKey) throw new Error("Google Gemini 缺少 API Key");
    const baseURL = settings.baseURL ? assertSafeBaseURL(settings.baseURL) : undefined;
    const google = createGoogleGenerativeAI({ apiKey, baseURL, headers: safeHeaders(settings, "") });
    return { mode: "remote", model: google(settings.model), label: `Google · ${settings.model}` };
  }

  const baseURL = assertSafeBaseURL(settings.baseURL);
  if (!apiKey && settings.authMode !== "none") throw new Error(`${settings.providerName} 缺少 API Key`);
  const providerName = settings.providerName.replace(/[^a-zA-Z0-9]/g, "") || "customProvider";
  const compatible = createOpenAICompatible({
    name: providerName,
    baseURL,
    apiKey: settings.authMode === "bearer" ? apiKey || undefined : undefined,
    headers: safeHeaders(settings, apiKey),
    includeUsage: true,
  });
  return {
    mode: "remote",
    model: compatible.chatModel(settings.model),
    label: `${settings.providerName} · ${settings.model}`,
  };
}

export function publicModelError(error: unknown, apiKey = "") {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutSecret = apiKey ? raw.split(apiKey).join("[已隐藏]") : raw;
  return withoutSecret.slice(0, 1_000);
}
