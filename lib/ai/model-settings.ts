import { z } from "zod";

export const providerKindSchema = z.enum([
  "auto",
  "gateway",
  "openai-compatible",
  "anthropic",
  "google",
]);

export const authModeSchema = z.enum(["bearer", "api-key", "x-api-key", "none"]);
export const detailLevelSchema = z.enum(["concept", "balanced", "engineering"]);

const customHeadersSchema = z
  .record(z.string().min(1).max(80), z.string().max(2_000))
  .refine((headers) => Object.keys(headers).length <= 20, "自定义请求头最多 20 项");

export const modelSettingsSchema = z.object({
  provider: providerKindSchema,
  presetId: z.string().min(1).max(80),
  providerName: z.string().min(1).max(80),
  model: z.string().trim().min(1, "请填写模型 ID").max(200),
  baseURL: z.string().trim().max(2_000),
  apiKey: z.string().max(8_000),
  authMode: authModeSchema,
  customHeaders: customHeadersSchema,
  rememberApiKey: z.boolean(),
  generation: z.object({
    temperature: z.number().min(0).max(2).nullable(),
    topP: z.number().min(0).max(1).nullable(),
    maxOutputTokens: z.number().int().min(256).max(64_000),
    maxRetries: z.number().int().min(0).max(5),
    timeoutMs: z.number().int().min(5_000).max(300_000),
    maxSteps: z.number().int().min(1).max(8),
    seed: z.number().int().min(0).max(2_147_483_647).nullable(),
  }),
  builder: z.object({
    detailLevel: detailLevelSchema,
    strictBlockStates: z.boolean(),
    redstonePrecision: z.boolean(),
    preserveExisting: z.boolean(),
    autoRunAfterGeneration: z.boolean(),
    maxBuildBlocks: z.number().int().min(1_000).max(500_000),
    extraInstructions: z.string().max(4_000),
  }),
});

export type ModelSettings = z.infer<typeof modelSettingsSchema>;
export type ProviderKind = ModelSettings["provider"];

export type ProviderPreset = Pick<
  ModelSettings,
  "provider" | "presetId" | "providerName" | "model" | "baseURL" | "authMode"
> & {
  label: string;
  shortLabel: string;
  description: string;
  localOnly?: boolean;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    presetId: "auto",
    provider: "auto",
    providerName: "server",
    label: "自动 / 服务器配置",
    shortLabel: "AUTO",
    description: "优先使用服务器 AI Gateway；未配置时使用本地演示生成器。",
    model: "openai/gpt-5.4",
    baseURL: "",
    authMode: "bearer",
  },
  {
    presetId: "vercel-gateway",
    provider: "gateway",
    providerName: "gateway",
    label: "Vercel AI Gateway",
    shortLabel: "GATEWAY",
    description: "用一个密钥访问多个模型供应商，并保留统一的用量观测。",
    model: "openai/gpt-5.4",
    baseURL: "",
    authMode: "bearer",
  },
  {
    presetId: "openai",
    provider: "openai-compatible",
    providerName: "openaiCompatible",
    label: "OpenAI",
    shortLabel: "OPENAI",
    description: "OpenAI Chat Completions 兼容接口。",
    model: "gpt-5.4",
    baseURL: "https://api.openai.com/v1",
    authMode: "bearer",
  },
  {
    presetId: "deepseek",
    provider: "openai-compatible",
    providerName: "deepseek",
    label: "DeepSeek",
    shortLabel: "DEEPSEEK",
    description: "DeepSeek 官方 OpenAI 兼容接口。",
    model: "deepseek-chat",
    baseURL: "https://api.deepseek.com",
    authMode: "bearer",
  },
  {
    presetId: "openrouter",
    provider: "openai-compatible",
    providerName: "openrouter",
    label: "OpenRouter",
    shortLabel: "OPENROUTER",
    description: "通过 OpenRouter 使用聚合模型目录。",
    model: "anthropic/claude-sonnet-4.6",
    baseURL: "https://openrouter.ai/api/v1",
    authMode: "bearer",
  },
  {
    presetId: "siliconflow",
    provider: "openai-compatible",
    providerName: "siliconflow",
    label: "SiliconFlow 硅基流动",
    shortLabel: "SILICONFLOW",
    description: "国内可用的 OpenAI 兼容模型服务。",
    model: "deepseek-ai/DeepSeek-V3.2",
    baseURL: "https://api.siliconflow.cn/v1",
    authMode: "bearer",
  },
  {
    presetId: "moonshot",
    provider: "openai-compatible",
    providerName: "moonshot",
    label: "Moonshot / Kimi",
    shortLabel: "KIMI",
    description: "Moonshot 官方 OpenAI 兼容接口。",
    model: "kimi-k2.5",
    baseURL: "https://api.moonshot.cn/v1",
    authMode: "bearer",
  },
  {
    presetId: "dashscope",
    provider: "openai-compatible",
    providerName: "dashscope",
    label: "阿里云百炼 / Qwen",
    shortLabel: "QWEN",
    description: "DashScope OpenAI 兼容模式。",
    model: "qwen3-max",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    authMode: "bearer",
  },
  {
    presetId: "zhipu",
    provider: "openai-compatible",
    providerName: "zhipu",
    label: "智谱 GLM",
    shortLabel: "GLM",
    description: "智谱 BigModel OpenAI 兼容接口。",
    model: "glm-4.7",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    authMode: "bearer",
  },
  {
    presetId: "anthropic",
    provider: "anthropic",
    providerName: "anthropic",
    label: "Anthropic 原生",
    shortLabel: "CLAUDE",
    description: "直接调用 Anthropic Messages API，支持工具调用。",
    model: "claude-sonnet-4-6",
    baseURL: "https://api.anthropic.com/v1",
    authMode: "x-api-key",
  },
  {
    presetId: "google",
    provider: "google",
    providerName: "google",
    label: "Google Gemini 原生",
    shortLabel: "GEMINI",
    description: "直接调用 Google Generative AI API。",
    model: "gemini-2.5-pro",
    baseURL: "",
    authMode: "x-api-key",
  },
  {
    presetId: "ollama",
    provider: "openai-compatible",
    providerName: "ollama",
    label: "Ollama（本机）",
    shortLabel: "OLLAMA",
    description: "连接本机 Ollama 的 OpenAI 兼容接口；仅本地运行时可用。",
    model: "qwen3-coder:30b",
    baseURL: "http://localhost:11434/v1",
    authMode: "none",
    localOnly: true,
  },
  {
    presetId: "lm-studio",
    provider: "openai-compatible",
    providerName: "lmStudio",
    label: "LM Studio（本机）",
    shortLabel: "LM STUDIO",
    description: "连接本机 LM Studio Server；仅本地运行时可用。",
    model: "local-model",
    baseURL: "http://localhost:1234/v1",
    authMode: "none",
    localOnly: true,
  },
  {
    presetId: "custom",
    provider: "openai-compatible",
    providerName: "customProvider",
    label: "自定义 OpenAI 兼容接口",
    shortLabel: "CUSTOM",
    description: "填写任意兼容 Chat Completions 的 Base URL、认证和请求头。",
    model: "your-model-id",
    baseURL: "https://api.example.com/v1",
    authMode: "bearer",
  },
];

const AUTO_PRESET = PROVIDER_PRESETS[0];

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  provider: AUTO_PRESET.provider,
  presetId: AUTO_PRESET.presetId,
  providerName: AUTO_PRESET.providerName,
  model: AUTO_PRESET.model,
  baseURL: AUTO_PRESET.baseURL,
  authMode: AUTO_PRESET.authMode,
  apiKey: "",
  customHeaders: {},
  rememberApiKey: true,
  generation: {
    temperature: 0.2,
    topP: null,
    maxOutputTokens: 16_000,
    maxRetries: 2,
    timeoutMs: 120_000,
    maxSteps: 4,
    seed: null,
  },
  builder: {
    detailLevel: "engineering",
    strictBlockStates: true,
    redstonePrecision: true,
    preserveExisting: true,
    autoRunAfterGeneration: true,
    maxBuildBlocks: 200_000,
    extraInstructions: "",
  },
};

const PREFERENCES_KEY = "forgescript:model-settings:v1";
const SECRET_KEY = "forgescript:model-api-key:v1";

export function getProviderPreset(id: string) {
  return PROVIDER_PRESETS.find((preset) => preset.presetId === id) ?? PROVIDER_PRESETS[0];
}

export function providerLabel(settings: ModelSettings) {
  const preset = PROVIDER_PRESETS.find((item) => item.presetId === settings.presetId);
  return preset?.shortLabel ?? settings.providerName.toUpperCase();
}

export function loadModelSettings(): ModelSettings {
  if (typeof window === "undefined") return DEFAULT_MODEL_SETTINGS;
  try {
    const saved = window.localStorage.getItem(PREFERENCES_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    const secret = window.sessionStorage.getItem(SECRET_KEY) ?? "";
    const candidate = {
      ...DEFAULT_MODEL_SETTINGS,
      ...parsed,
      apiKey: secret,
      generation: { ...DEFAULT_MODEL_SETTINGS.generation, ...parsed.generation },
      builder: { ...DEFAULT_MODEL_SETTINGS.builder, ...parsed.builder },
    };
    const validated = modelSettingsSchema.safeParse(candidate);
    return validated.success ? validated.data : DEFAULT_MODEL_SETTINGS;
  } catch {
    return DEFAULT_MODEL_SETTINGS;
  }
}

export function saveModelSettings(settings: ModelSettings) {
  if (typeof window === "undefined") return;
  const preferences = { ...settings, apiKey: "" };
  window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  if (settings.rememberApiKey && settings.apiKey) {
    window.sessionStorage.setItem(SECRET_KEY, settings.apiKey);
  } else {
    window.sessionStorage.removeItem(SECRET_KEY);
  }
}
