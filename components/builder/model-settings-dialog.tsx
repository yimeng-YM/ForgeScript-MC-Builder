"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog } from "radix-ui";
import {
  Blocks,
  Check,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  TestTube2,
  X,
} from "lucide-react";
import {
  getProviderPreset,
  modelSettingsSchema,
  PROVIDER_PRESETS,
  type ModelSettings,
} from "@/lib/ai/model-settings";

type SettingsTab = "provider" | "generation" | "builder";
type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ModelSettings;
  onSave: (settings: ModelSettings) => void;
};

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

export function ModelSettingsDialog({ open, onOpenChange, value, onSave }: Props) {
  const [tab, setTab] = useState<SettingsTab>("provider");
  const [draft, setDraft] = useState(value);
  const [headersText, setHeadersText] = useState("{}");
  const [showSecret, setShowSecret] = useState(false);
  const [formError, setFormError] = useState("");
  const [testState, setTestState] = useState<TestState>({ status: "idle" });

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      setDraft(value);
      setHeadersText(JSON.stringify(value.customHeaders, null, 2));
      setFormError("");
      setTestState({ status: "idle" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, value]);

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

  const testConnection = async () => {
    setFormError("");
    setTestState({ status: "testing" });
    try {
      const settings = validatedDraft();
      const response = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const result = await response.json() as {
        ok?: boolean;
        error?: string;
        label?: string;
        latencyMs?: number;
        message?: string;
      };
      if (!response.ok || !result.ok) throw new Error(result.error || "连接测试失败");
      setTestState({
        status: "success",
        message: `${result.label ?? settings.model} · ${result.latencyMs ?? 0} ms · ${result.message ?? "连接成功"}`,
      });
    } catch (error) {
      setTestState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const save = () => {
    setFormError("");
    try {
      const settings = validatedDraft();
      onSave(settings);
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
                选择供应商、调整采样参数，并定义 Minecraft 结构生成精度。
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
                <span><strong>BYOK 安全模式</strong><small>密钥不写入项目源码或长期浏览器存储。</small></span>
              </div>
            </nav>

            <div className="settings-content">
              {tab === "provider" && (
                <section className="settings-section" aria-labelledby="provider-settings-title">
                  <div className="settings-section-heading">
                    <div><span>CONNECTION</span><h2 id="provider-settings-title">模型供应商</h2></div>
                    <span className={`settings-protocol ${draft.provider}`}>{draft.provider.replace("openai-compatible", "OPENAI COMPATIBLE")}</span>
                  </div>

                  <Field label="供应商预设" hint={preset.description}>
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
                    <div className="settings-callout warning"><CircleAlert size={15} /><span>本机模型只在本地运行 ForgeScript 时可连接；已部署网页无法访问你电脑的 localhost。</span></div>
                  )}

                  <div className="settings-grid two">
                    <Field label="模型 ID" hint={draft.provider === "gateway" || draft.provider === "auto" ? "Gateway 使用 provider/model 格式" : "必须与供应商控制台中的模型名称一致"}>
                      <input value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} spellCheck={false} />
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

                  <Field label="API Key" hint="留空时会尝试使用服务器环境变量；自动模式留空可回退到本地演示。">
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
                    <Field label="最大输出 Token" hint="大型建筑脚本需要更高上限">
                      <input type="number" min="256" max="64000" step="256" value={draft.generation.maxOutputTokens} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, maxOutputTokens: Number(event.target.value) } }))} />
                    </Field>
                    <Field label="工具调用步数" hint="允许模型修正并最终提交源码，范围 1–8">
                      <input type="number" min="1" max="8" value={draft.generation.maxSteps} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, maxSteps: Number(event.target.value) } }))} />
                    </Field>
                    <Field label="失败重试次数" hint="不含模型主动工具调用">
                      <input type="number" min="0" max="5" value={draft.generation.maxRetries} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, maxRetries: Number(event.target.value) } }))} />
                    </Field>
                    <Field label="请求超时（秒）" hint="复杂结构建议 60–180 秒">
                      <input type="number" min="5" max="300" value={Math.round(draft.generation.timeoutMs / 1000)} onChange={(event) => setDraft((current) => ({ ...current, generation: { ...current.generation, timeoutMs: Number(event.target.value) * 1000 } }))} />
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
                  <Field label="最大结构方块数" hint="同时作为模型约束；实际执行仍受沙箱硬限制">
                    <input type="number" min="1000" max="500000" step="1000" value={draft.builder.maxBuildBlocks} onChange={(event) => setDraft((current) => ({ ...current, builder: { ...current.builder, maxBuildBlocks: Number(event.target.value) } }))} />
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
              {testState.status === "testing" && <><LoaderCircle size={14} className="spin" /> 正在执行真实模型连接测试…</>}
              {testState.status === "success" && <><Check size={14} /> {testState.message}</>}
              {testState.status === "error" && <><CircleAlert size={14} /> {testState.message}</>}
              {testState.status === "idle" && formError && <><CircleAlert size={14} /> {formError}</>}
              {testState.status === "idle" && !formError && <><ShieldCheck size={14} /> 普通设置保存在本机；密钥只随模型请求发送到服务端。</>}
            </div>
            <div className="settings-footer-actions">
              <button className="test-model-button" onClick={() => void testConnection()} disabled={testState.status === "testing"}>
                {testState.status === "testing" ? <LoaderCircle size={14} className="spin" /> : <TestTube2 size={14} />}测试连接
              </button>
              <button className="save-settings-button" onClick={save}><Check size={14} />保存设置</button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
