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
export const knowledgeModuleModeSchema = z.enum(["auto", "on", "off"]);
export const reasoningEffortSchema = z.enum(["off", "low", "medium", "high"]);

export const DEFAULT_GENERATION_TIMEOUT_MS = 30 * 60 * 1_000;
export const MAX_GENERATION_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
export const DEFAULT_SCRIPT_TIMEOUT_MS = 15_000;
export const MAX_SCRIPT_TIMEOUT_MS = 60_000;

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
  capabilities: z.object({
    vision: z.boolean(),
  }),
  generation: z.object({
    temperature: z.number().min(0).max(2).nullable(),
    topP: z.number().min(0).max(1).nullable(),
    maxOutputTokens: z.number().int().min(256),
    maxRetries: z.number().int().min(0).max(5),
    timeoutMs: z.number().int().min(5_000).max(MAX_GENERATION_TIMEOUT_MS),
    maxSteps: z.number().int().min(2).max(12),
    reasoningEffort: reasoningEffortSchema,
    seed: z.number().int().min(0).max(2_147_483_647).nullable(),
  }),
  builder: z.object({
    detailLevel: detailLevelSchema,
    strictBlockStates: z.boolean(),
    redstonePrecision: z.boolean(),
    preserveExisting: z.boolean(),
    autoRunAfterGeneration: z.boolean(),
    maxAutoFixAttempts: z.number().int().min(0).max(6),
    maxBuildBlocks: z.number().int().min(1_000).max(500_000),
    executionTimeoutMs: z.number().int().min(1_000).max(MAX_SCRIPT_TIMEOUT_MS),
    extraInstructions: z.string().max(4_000),
    redstoneCircuitModule: knowledgeModuleModeSchema,
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
  visionDefault?: boolean;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    presetId: "auto",
    provider: "auto",
    providerName: "browser",
    label: "自动 / 浏览器直连",
    shortLabel: "AUTO",
    description: "填写 Gateway Key 后由浏览器直连；留空时使用浏览器本地演示生成器。",
    model: "openai/gpt-5.4",
    baseURL: "",
    authMode: "bearer",
    visionDefault: true,
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
    visionDefault: true,
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
    visionDefault: true,
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
    visionDefault: true,
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
    visionDefault: true,
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
    visionDefault: true,
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
    visionDefault: true,
  },
  {
    presetId: "ollama",
    provider: "openai-compatible",
    providerName: "ollama",
    label: "Ollama（本机）",
    shortLabel: "OLLAMA",
    description: "由当前浏览器连接本机 Ollama 的 OpenAI 兼容接口；请将模型上下文（num_ctx）调到 32k 以上，否则服务端会静默截断长输出。",
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
    description: "由当前浏览器连接本机 LM Studio Server；请把模型上下文长度调大，否则长输出会被服务端截断。",
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
  capabilities: {
    vision: AUTO_PRESET.visionDefault ?? false,
  },
  generation: {
    temperature: 0.2,
    topP: null,
    maxOutputTokens: 32_768,
    maxRetries: 2,
    timeoutMs: DEFAULT_GENERATION_TIMEOUT_MS,
    maxSteps: 6,
    reasoningEffort: "medium",
    seed: null,
  },
  builder: {
    detailLevel: "engineering",
    strictBlockStates: true,
    redstonePrecision: true,
    preserveExisting: true,
    autoRunAfterGeneration: true,
    maxAutoFixAttempts: 3,
    maxBuildBlocks: 200_000,
    executionTimeoutMs: DEFAULT_SCRIPT_TIMEOUT_MS,
    extraInstructions: "",
    redstoneCircuitModule: "auto",
  },
};

const PREFERENCES_KEY = "forgescript:model-settings:v1";
const SECRET_KEY = "forgescript:model-api-key:v1";
const PROFILES_KEY = "forgescript:model-profiles:v1";
const ACTIVE_PROFILE_KEY = "forgescript:active-model-profile:v1";
const PROFILE_SECRET_PREFIX = "forgescript:model-profile-key:v1:";
const LEGACY_DEFAULT_GENERATION_TIMEOUT_MS = 120_000;

export type ModelProfile = {
  id: string;
  name: string;
  settings: ModelSettings;
  updatedAt: number;
};

export function getProviderPreset(id: string) {
  return PROVIDER_PRESETS.find((preset) => preset.presetId === id) ?? PROVIDER_PRESETS[0];
}

export function providerLabel(settings: ModelSettings) {
  const preset = PROVIDER_PRESETS.find((item) => item.presetId === settings.presetId);
  return preset?.shortLabel ?? settings.providerName.toUpperCase();
}

export function inferVisionCapability(modelId: string) {
  const id = modelId.toLowerCase();
  if (/\b(embedding|embed|rerank|tts|whisper|audio|moderation)\b/.test(id)) return false;
  return /(gpt-4(?:o|\.1)|gpt-5|o[134]|claude|gemini|vision|vl|pixtral|llava|kimi-k2\.5)/.test(id);
}

export function loadModelSettings(): ModelSettings {
  if (typeof window === "undefined") return DEFAULT_MODEL_SETTINGS;
  try {
    const saved = window.localStorage.getItem(PREFERENCES_KEY);
    const parsed = saved ? JSON.parse(saved) : {};
    const secret = window.localStorage.getItem(SECRET_KEY) ?? "";
    const generation = { ...DEFAULT_MODEL_SETTINGS.generation, ...parsed.generation };
    if (generation.timeoutMs === LEGACY_DEFAULT_GENERATION_TIMEOUT_MS) {
      generation.timeoutMs = DEFAULT_GENERATION_TIMEOUT_MS;
    }
    const candidate = {
      ...DEFAULT_MODEL_SETTINGS,
      ...parsed,
      apiKey: secret,
      generation,
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
    window.localStorage.setItem(SECRET_KEY, settings.apiKey);
  } else {
    window.localStorage.removeItem(SECRET_KEY);
  }
}

function profileSettings(candidate: unknown, apiKey: string) {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Partial<ModelSettings>;
  const parsed = modelSettingsSchema.safeParse({
    ...DEFAULT_MODEL_SETTINGS,
    ...value,
    apiKey,
    capabilities: { ...DEFAULT_MODEL_SETTINGS.capabilities, ...value.capabilities },
    generation: { ...DEFAULT_MODEL_SETTINGS.generation, ...value.generation },
    builder: { ...DEFAULT_MODEL_SETTINGS.builder, ...value.builder },
  });
  return parsed.success ? parsed.data : null;
}

export function loadModelProfiles(): { profiles: ModelProfile[]; activeProfileId: string } {
  if (typeof window === "undefined") {
    return {
      profiles: [{ id: "default", name: "默认配置", settings: DEFAULT_MODEL_SETTINGS, updatedAt: 0 }],
      activeProfileId: "default",
    };
  }

  try {
    const stored = JSON.parse(window.localStorage.getItem(PROFILES_KEY) ?? "[]") as unknown;
    const entries = Array.isArray(stored) ? stored : [];
    const profiles = entries.flatMap((entry): ModelProfile[] => {
      if (!entry || typeof entry !== "object") return [];
      const raw = entry as Partial<ModelProfile>;
      if (typeof raw.id !== "string" || typeof raw.name !== "string") return [];
      const apiKey = window.localStorage.getItem(`${PROFILE_SECRET_PREFIX}${raw.id}`) ?? "";
      const settings = profileSettings(raw.settings, apiKey);
      if (!settings) return [];
      return [{
        id: raw.id,
        name: raw.name.slice(0, 60) || "未命名配置",
        settings,
        updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
      }];
    });

    if (profiles.length === 0) {
      const migrated = loadModelSettings();
      return {
        profiles: [{ id: "default", name: "默认配置", settings: migrated, updatedAt: Date.now() }],
        activeProfileId: "default",
      };
    }

    const requestedActiveId = window.localStorage.getItem(ACTIVE_PROFILE_KEY);
    const activeProfileId = profiles.some((profile) => profile.id === requestedActiveId)
      ? requestedActiveId!
      : profiles[0].id;
    return { profiles, activeProfileId };
  } catch {
    return {
      profiles: [{ id: "default", name: "默认配置", settings: loadModelSettings(), updatedAt: Date.now() }],
      activeProfileId: "default",
    };
  }
}

export function saveModelProfiles(profiles: ModelProfile[], activeProfileId: string) {
  if (typeof window === "undefined") return;
  try {
    try {
      const previous = JSON.parse(window.localStorage.getItem(PROFILES_KEY) ?? "[]") as unknown;
      if (Array.isArray(previous)) {
        const retainedIds = new Set(profiles.map((profile) => profile.id));
        for (const entry of previous) {
          if (entry && typeof entry === "object" && "id" in entry && typeof entry.id === "string" && !retainedIds.has(entry.id)) {
            window.localStorage.removeItem(`${PROFILE_SECRET_PREFIX}${entry.id}`);
          }
        }
      }
    } catch {
      // Ignore malformed legacy profile data; the validated replacement below repairs it.
    }

    const safeProfiles = profiles.slice(0, 20).map((profile) => ({
      ...profile,
      name: profile.name.trim().slice(0, 60) || "未命名配置",
      settings: { ...profile.settings, apiKey: "" },
    }));
    if (safeProfiles.length === 0) throw new Error("至少需要保留一个模型预设");
    const safeActiveProfileId = safeProfiles.some((profile) => profile.id === activeProfileId)
      ? activeProfileId
      : safeProfiles[0].id;

    window.localStorage.setItem(PROFILES_KEY, JSON.stringify(safeProfiles));
    window.localStorage.setItem(ACTIVE_PROFILE_KEY, safeActiveProfileId);

    for (const profile of profiles) {
      const key = `${PROFILE_SECRET_PREFIX}${profile.id}`;
      if (profile.settings.rememberApiKey && profile.settings.apiKey) {
        window.localStorage.setItem(key, profile.settings.apiKey);
      } else {
        window.localStorage.removeItem(key);
      }
    }

    const active = profiles.find((profile) => profile.id === safeActiveProfileId);
    if (active) saveModelSettings(active.settings);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`模型预设未能写入浏览器存储：${reason}`);
  }
}

export function createModelProfile(settings: ModelSettings, name = "新模型配置"): ModelProfile {
  return {
    id: crypto.randomUUID(),
    name,
    settings,
    updatedAt: Date.now(),
  };
}
