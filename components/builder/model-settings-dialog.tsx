"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "radix-ui";
import {
  Blocks,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleAlert,
  CopyPlus,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  TestTube2,
  Trash2,
  X,
} from "lucide-react";
import {
  createModelProfile,
  DEFAULT_MODEL_SETTINGS,
  MAX_GENERATION_TIMEOUT_MS,
  MAX_SCRIPT_TIMEOUT_MS,
  getProviderPreset,
  modelSettingsSchema,
  PROVIDER_PRESETS,
  type ModelProfile,
  type ModelSettings,
} from "@/lib/ai/model-settings";
import {
  fetchClientModelCatalog,
  testClientModelConnection,
  type CatalogModel,
} from "@/lib/ai/client-models";

type SettingsTab = "provider" | "generation" | "builder";
type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: ModelProfile[];
  activeProfileId: string;
  onSave: (profiles: ModelProfile[], activeProfileId: string) => void;
};

type CatalogState =
  | { status: "idle"; models: CatalogModel[] }
  | { status: "loading"; models: CatalogModel[] }
  | { status: "success"; models: CatalogModel[]; source: string }
  | { status: "error"; models: CatalogModel[]; message: string };

function parseHeaders(text: string) {
  if (!text.trim()) return {};
  const value: unknown = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("自定义请求头必须是 JSON 对象");
  }
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string") throw new Error(`请求头 ${name} 的值必须是字符串`);
  }
  return value as Record<string, string>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="settings-field">
      <span className="settings-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function ToggleRow({
  checked,
  title,
  description,
  onChange,
}: {
  checked: boolean;
  title: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-toggle-row">
      <span><strong>{title}</strong><small>{description}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="settings-switch" aria-hidden="true"><span /></span>
    </label>
  );
}

export function ModelSettingsDialog({ open, onOpenChange, profiles, activeProfileId, onSave }: Props) {
  const [tab, setTab] = useState<SettingsTab>("provider");
  const initialProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const [profileDrafts, setProfileDrafts] = useState(profiles);
  const [selectedProfileId, setSelectedProfileId] = useState(initialProfile.id);
  const [profileName, setProfileName] = useState(initialProfile.name);
  const [draft, setDraft] = useState(initialProfile.settings);
  const [headersText, setHeadersText] = useState("{}");
  const [showSecret, setShowSecret] = useState(false);
  const [formError, setFormError] = useState("");
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: "idle", models: [] });

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
      setProfileDrafts(profiles);
      setSelectedProfileId(active.id);
      setProfileName(active.name);
      setDraft(active.settings);
      setHeadersText(JSON.stringify(active.settings.customHeaders, null, 2));
      setFormError("");
      setTestState({ status: "idle" });
      setCatalogState({ status: "idle", models: [] });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeProfileId, open, profiles]);

  const preset = useMemo(() => getProviderPreset(draft.presetId), [draft.presetId]);

  const applyPreset = (presetId: string) => {
    const next = getProviderPreset(presetId);
    setDraft((current) => ({
      ...current,
      provider: next.provider,
      presetId: next.presetId,
      providerName: next.providerName,
      model: next.model,
      baseURL: next.baseURL,
      authMode: next.authMode,
      apiKey: "",
      customHeaders: {},
      capabilities: { vision: next.visionDefault ?? false },
    }));
    setHeadersText("{}");
    setFormError("");
    setTestState({ status: "idle" });
  };

  const validatedDraft = () => {
    const customHeaders = parseHeaders(headersText);
    const parsed = modelSettingsSchema.safeParse({ ...draft, customHeaders });
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "模型配置无效");
    }
    return parsed.data;
  };

  const snapshotProfiles = (settings = validatedDraft()) => profileDrafts.map((profile) =>
    profile.id === selectedProfileId
      ? { ...profile, name: profileName.trim() || "未命名配置", settings, updatedAt: Date.now() }
      : profile,
  );

  const switchProfile = (profileId: string) => {
    try {
      const nextProfiles = snapshotProfiles();
      const next = nextProfiles.find((profile) => profile.id === profileId);
      if (!next) return;
      setProfileDrafts(nextProfiles);
      setSelectedProfileId(next.id);
      setProfileName(next.name);
      setDraft(next.settings);
      setHeadersText(JSON.stringify(next.settings.customHeaders, null, 2));
      setCatalogState({ status: "idle", models: [] });
      setFormError("");
      setTestState({ status: "idle" });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const duplicateProfile = () => {
    if (profileDrafts.length >= 20) {
      setFormError("最多保存 20 个模型配置");
      return;
    }
    try {
      const settings = validatedDraft();
      const currentProfiles = snapshotProfiles(settings);
      const next = createModelProfile(settings, `${profileName.trim() || "模型配置"} 副本`);
      setProfileDrafts([...currentProfiles, next]);
      setSelectedProfileId(next.id);
      setProfileName(next.name);
      setDraft(next.settings);
      setHeadersText(JSON.stringify(next.settings.customHeaders, null, 2));
      setCatalogState({ status: "idle", models: [] });
      setFormError("");
      setTestState({ status: "idle" });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const newProfile = () => {
    if (profileDrafts.length >= 20) {
      setFormError("最多保存 20 个模型配置");
      return;
    }
    try {
      const currentProfiles = snapshotProfiles();
      const next = createModelProfile(DEFAULT_MODEL_SETTINGS, "新模型配置");
      setProfileDrafts([...currentProfiles, next]);
      setSelectedProfileId(next.id);
      setProfileName(next.name);
      setDraft(next.settings);
      setHeadersText(JSON.stringify(next.settings.customHeaders, null, 2));
      setCatalogState({ status: "idle", models: [] });
      setFormError("");
      setTestState({ status: "idle" });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteProfile = () => {
    if (profileDrafts.length <= 1) return;
    const nextProfiles = profileDrafts.filter((profile) => profile.id !== selectedProfileId);
    const next = nextProfiles[0];
    setProfileDrafts(nextProfiles);
    setSelectedProfileId(next.id);
    setProfileName(next.name);
    setDraft(next.settings);
    setHeadersText(JSON.stringify(next.settings.customHeaders, null, 2));
    setCatalogState({ status: "idle", models: [] });
    setFormError("");
    setTestState({ status: "idle" });
  };

  const fetchModels = async () => {
    setFormError("");
    setCatalogState((current) => ({ status: "loading", models: current.models }));
    try {
      const settings = validatedDraft();
      const result = await fetchClientModelCatalog(settings);
      setCatalogState({ status: "success", models: result.models, source: result.source });
    } catch (error) {
      setCatalogState({
        status: "error",
        models: [],
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const testConnection = async () => {
    setFormError("");
    setTestState({ status: "testing" });
    try {
      const settings = validatedDraft();
      const result = await testClientModelConnection(settings);
      setTestState({
        status: "success",
        message: `${result.label} · ${result.latencyMs} ms · ${result.message}`,
      });
    } catch (error) {
      setTestState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const save = () => {
    setFormError("");
    try {
      const settings = validatedDraft();
      onSave(snapshotProfiles(settings), selectedProfileId);
      onOpenChange(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="settings-overlay" />
        <Dialog.Content className="settings-dialog" aria-describedby="model-settings-description">
          <header className="settings-header">
            <div className="settings-title-icon"><ServerCog size={19} /></div>
            <div>
              <Dialog.Title>模型与生成设置</Dialog.Title>
              <Dialog.Description id="model-settings-description">
                浏览器直接连接模型供应商；Cloudflare 不再中转 AI 请求。
              </Dialog.Description>
            </div>
            <Dialog.Close className="settings-close" aria-label="关闭模型设置"><X size={17} /></Dialog.Close>
          </header>

          <div className="settings-body">
            <nav className="settings-nav" aria-label="设置分类">
              <button className={tab === "provider" ? "active" : ""} onClick={() => setTab("provider")}>
                <ServerCog size={16} /><span><strong>模型供应商</strong><small>接口、模型与密钥</small></span><ChevronRight size={14} />
              </button>
              <button className={tab === "generation" ? "active" : ""} onClick={() => setTab("generation")}>
                <SlidersHorizontal size={16} /><span><strong>生成参数</strong><small>采样、Token 与重试</small></span><ChevronRight size={14} />
              </button>
              <button className={tab === "builder" ? "active" : ""} onClick={() => setTab("builder")}>
                <Blocks size={16} /><span><strong>Minecraft</strong><small>精度与构建策略</small></span><ChevronRight size={14} />
              </button>
              <div className="settings-security-note">
                <ShieldCheck size={16} />
                <span><strong>浏览器直连 BYOK</strong><small>密钥仅发送给所选供应商，不经过 ForgeScript Worker。</small></span>
              </div>
            </nav>

            <div className="settings-content">
              {tab === "provider" && (
                <section className="settings-section" aria-labelledby="provider-settings-title">
                  <div className="settings-section-heading">
                    <div><span>CONNECTION</span><h2 id="provider-settings-title">模型供应商</h2></div>
                    <span className={`settings-protocol ${draft.provider}`}>{draft.provider.replace("openai-compatible", "OPENAI COMPATIBLE")}</span>
                  </div>

                  <div className="profile-manager">
                    <label>
                      <span>已保存配置</span>
                      <select value={selectedProfileId} onChange={(event) => switchProfile(event.target.value)}>
                        {profileDrafts.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>配置名称</span>
                      <input value={profileName} maxLength={60} onChange={(event) => setProfileName(event.target.value)} />
                    </label>
                    <div className="profile-actions">
                      <button type="button" onClick={newProfile} disabled={profileDrafts.length >= 20} title="创建空白模型预设"><Plus size={14} />新建</button>
                      <button type="button" onClick={duplicateProfile} disabled={profileDrafts.length >= 20} title="将当前设置保存为另一个预设"><CopyPlus size={14} />另存为</button>
                      <button type="button" className="danger" onClick={deleteProfile} disabled={profileDrafts.length <= 1} title="删除当前配置"><Trash2 size={14} /></button>
                    </div>
                    <p className="profile-manager-hint">新建或另存为后，请点击底部“保存预设”完成持久化；最多保存 20 个。</p>
                  </div>

                  <Field label="供应商模板" hint={preset.description}>
                    <select value={draft.presetId} onChange={(event) => applyPreset(event.target.value)}>
                      <optgroup label="自动与网关">
                        {PROVIDER_PRESETS.filter((item) => ["auto", "vercel-gateway"].includes(item.presetId)).map((item) => <option key={item.presetId} value={item.presetId}>{item.label}</option>)}
                      </optgroup>
                      <optgroup label="云端供应商">
                        {PROVIDER_PRESETS.filter((item) => !item.localOnly && !["auto", "vercel-gateway", "custom"].includes(item.presetId)).map((item) => <option key={item.presetId} value={item.presetId}>{item.label}</option>)}
                      </optgroup>
                      <optgroup label="本机与自定义">
                        {PROVIDER_PRESETS.filter((item) => item.localOnly || item.presetId === "custom").map((item) => <option key={item.presetId} value={item.presetId}>{item.label}</option>)}
                      </optgroup>
                    </select>
                  </Field>

                  {preset.localOnly && (
                    <div className="settings-callout warning"><CircleAlert size={15} /><span>部署后的网页会从浏览器尝试访问 localhost；本机服务必须允许当前网页 Origin，且浏览器不能拦截 CORS、私有网络访问或混合内容。</span></div>
                  )}

                  <div className="settings-grid two">
                    <Field label="模型 ID" hint={draft.provider === "gateway" || draft.provider === "auto" ? "Gateway 使用 provider/model 格式" : "必须与供应商控制台中的模型名称一致"}>
                      <div className="model-id-control">
                        <input value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} spellCheck={false} />
                        <button type="button" onClick={() => void fetchModels()} disabled={catalogState.status === "loading"}>
                          {catalogState.status === "loading" ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}
                          获取列表
                        </button>
                      </div>
                      {catalogState.models.length > 0 && (
                        <select
                          className="model-catalog"
                          value={catalogState.models.some((model) => model.id === draft.model) ? draft.model : ""}
                          onChange={(event) => {
                            const model = catalogState.models.find((item) => item.id === event.target.value);
                            if (!model) return;
                            setDraft((current) => ({
                              ...current,
                              model: model.id,
                              capabilities: { ...current.capabilities, vision: model.vision },
                            }));
                          }}
                        >
                          <option value="">从 {catalogState.status === "success" ? catalogState.source : "目录"} 选择（{catalogState.models.length}）</option>
                          {catalogState.models.map((model) => <option key={model.id} value={model.id}>{model.name === model.id ? model.id : `${model.name} · ${model.id}`}{model.vision ? " · 视觉" : ""}</option>)}
                        </select>
                      )}
                      {catalogState.status === "error" && <small className="model-catalog-error">{catalogState.message}</small>}
                    </Field>
                    {draft.provider === "openai-compatible" && (
                      <Field label="供应商标识" hint="用于区分请求元数据，仅允许简短名称">
                        <input value={draft.providerName} onChange={(event) => setDraft((current) => ({ ...current, providerName: event.target.value }))} spellCheck={false} />
                      </Field>
                    )}
                  </div>

                  {!(["auto", "gateway"] as string[]).includes(draft.provider) && (
                    <Field label="Base URL" hint={draft.provider === "google" ? "留空使用 Google 官方地址；也可填写兼容代理" : "需要包含 API 版本路径，例如 /v1"}>
                      <input type="url" value={draft.baseURL} onChange={(event) => setDraft((current) => ({ ...current, baseURL: event.target.value }))} spellCheck={false} placeholder="https://api.example.com/v1" />
                    </Field>
                  )}

                  <Field label="API Key" hint="远程模型必须填写；不会读取服务器环境变量。自动模式留空时使用浏览器本地演示。">
                    <div className="secret-input">
                      <KeyRound size={14} />
                      <input type={showSecret ? "text" : "password"} value={draft.apiKey} onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))} autoComplete="off" placeholder="sk-…" />
                      <button type="button" onClick={() => setShowSecret((current) => !current)} aria-label={showSecret ? "隐藏 API Key" : "显示 API Key"}>{showSecret ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                    </div>
                  </Field>

                  <ToggleRow
                    checked={draft.rememberApiKey}
                    title="在当前标签页中记住密钥"
                    description="使用 sessionStorage；关闭标签页后自动清除，不写入 localStorage。"
                    onChange={(rememberApiKey) => setDraft((current) => ({ ...current, rememberApiKey }))}
                  />

                  <ToggleRow
                    checked={draft.capabilities.vision}
                    title="启用视觉输入"
                    description="仅为确认支持图片理解的模型开启；开启后对话框可上传 PNG、JPEG、WebP 或 GIF。"
                    onChange={(vision) => setDraft((current) => ({ ...current, capabilities: { ...current.capabilities, vision } }))}
                  />

                  {!(["auto", "gateway"] as string[]).includes(draft.provider) && (
                    <div className={`settings-grid ${draft.provider === "openai-compatible" ? "two" : ""}`}>
                      {draft.provider === "openai-compatible" && (
                      <Field label="认证方式" hint="Azure 等接口可能使用 api-key 请求头">
                        <select value={draft.authMode} onChange={(event) => setDraft((current) => ({ ...current, authMode: event.target.value as ModelSettings["authMode"] }))}>
                          <option value="bearer">Authorization: Bearer</option>
                          <option value="api-key">api-key 请求头</option>
                          <option value="x-api-key">x-api-key 请求头</option>
                          <option value="none">无认证</option>
                        </select>
                      </Field>
                      )}
                      <Field label="自定义请求头（JSON）" hint="Host、Cookie 等危险请求头会被忽略">
                        <textarea rows={3} value={headersText} onChange={(event) => setHeadersText(event.target.value)} spellCheck={false} />
                      </Field>
                    </div>
                  )}
                </section>
              )}

              {tab === "generation" && (
                <section className="settings-section" aria-labelledby="generation-settings-title">
                  <div className="settings-section-heading"><div><span>INFERENCE</span><h2 id="generation-settings-title">生成参数</h2></div></div>
                  <div className="settings-callout"><SlidersHorizontal size={15} /><span>建筑脚本偏向确定性输出。Top P 启用时会自动停用 Temperature，避免重复采样控制。</span></div>
                  <div className="settings-callout"><BrainCircuit size={15} /><span>推理强度控制供应商的 reasoning 输出。界面展示模型提供的推理摘要和工具轨迹，不展示私有内部思维链。</span></div>
                  <div className="settings-grid two">
                    <Field label="Temperature" hint="越低越稳定；建筑与红石建议 0–0.3">
                      <input type="number" min="0" max="2" step="0.05" disabled={draft.generation.topP !== null} value={draft.generation.temperature ?? 0.2} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, temperature: Number(event.target.value) } }))} />
                    </Field>
                    <Field label="Top P" hint="留空时使用 Temperature">
                      <div className="optional-number">
                        <input type="checkbox" checked={draft.generation.topP !== null} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, topP: event.target.checked ? 0.9 : null } }))} aria-label="启用 Top P" />
                        <input type="number" min="0" max="1" step="0.05" disabled={draft.generation.topP === null} value={draft.generation.topP ?? 0.9} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, topP: Number(event.target.value) } }))} />
                      </div>
                    </Field>
                    <Field label="最大输出 Token" hint="不设上限，实际可用值以供应商为准；大型建筑脚本需要更高值，思维链共享此预算">
                      <input type="number" min="256" step="256" value={draft.generation.maxOutputTokens} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, maxOutputTokens: Number(event.target.value) } }))} />
                    </Field>
                    <Field label="Agent 最大步数" hint="每次沙箱拒绝后模型会读取错误并继续修正，范围 2–12">
                      <input type="number" min="2" max="12" value={draft.generation.maxSteps} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, maxSteps: Number(event.target.value) } }))} />
                    </Field>
                    <Field label="推理摘要强度" hint="并非所有供应商都支持；关闭可减少延迟和 Token">
                      <select value={draft.generation.reasoningEffort} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, reasoningEffort: event.target.value as ModelSettings["generation"]["reasoningEffort"] } }))}>
                        <option value="off">关闭</option>
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                      </select>
                    </Field>
                    <Field label="失败重试次数" hint="不含模型主动工具调用">
                      <input type="number" min="0" max="5" value={draft.generation.maxRetries} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, maxRetries: Number(event.target.value) } }))} />
                    </Field>
                    <Field label="AI 总超时（分钟）" hint="默认 30 分钟；深度思考或大型结构可提高到 60–120 分钟">
                      <input type="number" min="1" max={MAX_GENERATION_TIMEOUT_MS / 60_000} value={Math.round(draft.generation.timeoutMs / 60_000)} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, timeoutMs: Number(event.target.value) * 60_000 } }))} />
                    </Field>
                    <Field label="随机种子" hint="可选；仅在供应商支持时生效">
                      <div className="optional-number">
                        <input type="checkbox" checked={draft.generation.seed !== null} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, seed: event.target.checked ? 42 : null } }))} aria-label="启用随机种子" />
                        <input type="number" min="0" max="2147483647" disabled={draft.generation.seed === null} value={draft.generation.seed ?? 42} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, seed: Number(event.target.value) } }))} />
                      </div>
                    </Field>
                  </div>
                </section>
              )}

              {tab === "builder" && (
                <section className="settings-section" aria-labelledby="builder-settings-title">
                  <div className="settings-section-heading"><div><span>BUILD POLICY</span><h2 id="builder-settings-title">Minecraft 生成策略</h2></div></div>
                  <Field label="结构精度" hint="工程级会要求连接、内部结构、状态和施工合理性">
                    <select value={draft.builder.detailLevel} onChange={(event) => setDraft((current) => ({ ...current, builder: { ...current.builder, detailLevel: event.target.value as ModelSettings["builder"]["detailLevel"] } }))}>
                      <option value="concept">概念草图</option>
                      <option value="balanced">均衡</option>
                      <option value="engineering">工程级</option>
                    </select>
                  </Field>
                  <div className="settings-toggle-list">
                    <ToggleRow checked={draft.builder.strictBlockStates} title="严格方块状态" description="要求朝向、半砖位置、连接形态、充能状态等属性显式完整。" onChange={(strictBlockStates) => setDraft((current) => ({ ...current, builder: { ...current.builder, strictBlockStates } }))} />
                    <ToggleRow checked={draft.builder.redstonePrecision} title="红石工程模式" description="推导信号方向、延迟、准连接、更新顺序和容器状态。" onChange={(redstonePrecision) => setDraft((current) => ({ ...current, builder: { ...current.builder, redstonePrecision } }))} />
                    <ToggleRow checked={draft.builder.preserveExisting} title="保留现有结构" description="后续对话只修改相关源码；关闭后允许整体重构。" onChange={(preserveExisting) => setDraft((current) => ({ ...current, builder: { ...current.builder, preserveExisting } }))} />
                    <ToggleRow checked={draft.builder.autoRunAfterGeneration} title="生成后自动运行" description="AI 提交源码后立即进入 QuickJS 沙箱、校验并刷新 3D 预览。" onChange={(autoRunAfterGeneration) => setDraft((current) => ({ ...current, builder: { ...current.builder, autoRunAfterGeneration } }))} />
                  </div>
                  <Field label="二阶段自动修正次数" hint="Agent 沙箱通过后若版本方块注册表仍报错，前端会把完整诊断再次交回模型；0 表示关闭">
                    <input type="number" min="0" max="6" value={draft.builder.maxAutoFixAttempts} onChange={(event) => setDraft((current) => ({ ...current, builder: { ...current.builder, maxAutoFixAttempts: Number(event.target.value) } }))} />
                  </Field>
                  <Field label="最大结构方块数" hint="同时作为模型约束；实际执行仍受沙箱硬限制">
                    <input type="number" min="1000" max="500000" step="1000" value={draft.builder.maxBuildBlocks} onChange={(event) => setDraft((current) => ({ ...current, builder: { ...current.builder, maxBuildBlocks: Number(event.target.value) } }))} />
                  </Field>
                  <Field label="建筑脚本执行超时（秒）" hint="默认 15 秒；复杂几何可提高到 60 秒，无限循环仍会被安全中断">
                    <input type="number" min="1" max={MAX_SCRIPT_TIMEOUT_MS / 1_000} value={Math.round(draft.builder.executionTimeoutMs / 1_000)} onChange={(event) => setDraft((current) => ({ ...current, builder: { ...current.builder, executionTimeoutMs: Number(event.target.value) * 1_000 } }))} />
                  </Field>
                  <Field label="额外系统偏好" hint={`${draft.builder.extraInstructions.length}/4000 · 会作为建筑偏好加入系统指令`}>
                    <textarea rows={5} maxLength={4000} value={draft.builder.extraInstructions} onChange={(event) => setDraft((current) => ({ ...current, builder: { ...current.builder, extraInstructions: event.target.value } }))} placeholder="例如：优先使用生存模式容易获取的材料；所有维护通道至少 2 格高。" />
                  </Field>
                </section>
              )}
            </div>
          </div>

          <footer className="settings-footer">
            <div className={`connection-result ${testState.status}`} aria-live="polite">
              {testState.status === "testing" && <><LoaderCircle size={14} className="spin" /> 正在从浏览器执行真实模型连接测试…</>}
              {testState.status === "success" && <><Check size={14} /> {testState.message}</>}
              {testState.status === "error" && <><CircleAlert size={14} /> {testState.message}</>}
              {testState.status === "idle" && formError && <><CircleAlert size={14} /> {formError}</>}
              {testState.status === "idle" && !formError && <><ShieldCheck size={14} /> 当前有 {profileDrafts.length} 个预设草稿；保存后普通设置会保留在本机。</>}
            </div>
            <div className="settings-footer-actions">
              <button type="button" className="test-model-button" onClick={() => void testConnection()} disabled={testState.status === "testing"}>
                {testState.status === "testing" ? <LoaderCircle size={14} className="spin" /> : <TestTube2 size={14} />}测试连接
              </button>
              <button type="button" className="save-settings-button" onClick={save}><Check size={14} />保存预设</button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
