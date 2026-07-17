"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Box,
  Braces,
  Check,
  ChevronDown,
  CircleAlert,
  Code2,
  Cuboid,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Layers3,
  LoaderCircle,
  PanelRight,
  Play,
  Redo2,
  Send,
  Settings2,
  Sparkles,
  Undo2,
  WandSparkles,
  Zap,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { Viewport3D } from "./viewport-3d";
import { ModelSettingsDialog } from "./model-settings-dialog";
import {
  DEFAULT_MODEL_SETTINGS,
  loadModelSettings,
  providerLabel,
  saveModelSettings,
  type ModelSettings,
} from "@/lib/ai/model-settings";
import { DEFAULT_SOURCE } from "@/lib/minecraft/demo-source";
import { createLitematicBlob, safeLitematicName } from "@/lib/minecraft/litematic";
import { executeBuilderSource } from "@/lib/minecraft/runner";
import type {
  Diagnostic,
  PlacedBlock,
  VersionPack,
  WorldDocument,
} from "@/lib/minecraft/types";
import {
  getWorldStats,
  loadVersionPack,
  validateWorld,
  VERSION_OPTIONS,
} from "@/lib/minecraft/versions";

type WorkspaceTab = "preview" | "source" | "diagnostics";

const EMPTY_WORLD: WorldDocument = {
  name: "未运行的项目",
  version: "1.21.11",
  author: "LLM MC Builder",
  description: "",
  blocks: [],
};

const quickPrompts = ["生成一座云杉生存小屋", "设计可调延迟红石链", "建造一座铜顶瞭望塔"];

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function committedSource(message: UIMessage): string | null {
  for (const part of message.parts) {
    if (part.type !== "tool-commit_source" || !("input" in part)) continue;
    const input = part.input as { source?: unknown } | undefined;
    if (typeof input?.source === "string") return input.source;
  }
  return null;
}

function formatBytes(bytes: number) {
  if (!bytes) return "待发布";
  return `${Math.round(bytes / 1024)} KB`;
}

function lineCount(source: string) {
  return source.split("\n").length;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function BuilderWorkbench() {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [world, setWorld] = useState<WorldDocument>(EMPTY_WORLD);
  const [version, setVersion] = useState("1.21.11");
  const [pack, setPack] = useState<VersionPack | null>(null);
  const [packStatus, setPackStatus] = useState<"loading" | "ready" | "error">("loading");
  const [packError, setPackError] = useState("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("preview");
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<PlacedBlock | null>(null);
  const [xray, setXray] = useState(false);
  const [redstoneOnly, setRedstoneOnly] = useState(false);
  const [layer, setLayer] = useState<number | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettings>(DEFAULT_MODEL_SETTINGS);
  const [notice, setNotice] = useState("正在载入版本化方块注册表…");

  const stats = useMemo(() => getWorldStats(world), [world]);
  const maxY = useMemo(
    () => (world.blocks.length ? Math.max(...world.blocks.map((block) => block.y)) : 0),
    [world],
  );
  const blockingErrors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  const chatTransport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);

  const runWith = async (nextSource: string, nextPack: VersionPack) => {
    setRunning(true);
    setNotice("QuickJS 沙箱正在执行建筑脚本…");
    try {
      const nextWorld = await executeBuilderSource(nextSource);
      const nextDiagnostics = validateWorld(nextWorld, nextPack);
      setWorld(nextWorld);
      setDiagnostics(nextDiagnostics);
      setSelected(null);
      setNotice(
        nextDiagnostics.some((item) => item.severity === "error")
          ? `运行完成，但发现 ${nextDiagnostics.filter((item) => item.severity === "error").length} 个阻断错误`
          : `运行成功 · ${nextWorld.blocks.length.toLocaleString()} 个方块 · ${nextPack.blockCount.toLocaleString()} 个版本方块可用`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDiagnostics([
        {
          severity: "error",
          stage: "runtime",
          code: "SCRIPT_RUNTIME_ERROR",
          message,
        },
      ]);
      setNotice("源码运行失败；已保留上一次成功预览");
      setActiveTab("diagnostics");
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setModelSettings(loadModelSettings()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadVersionPack("1.21.11")
      .then(async (loaded) => {
        if (cancelled) return;
        setPack(loaded);
        setPackStatus("ready");
        await runWith(DEFAULT_SOURCE, loaded);
      })
      .catch((error) => {
        if (cancelled) return;
        setPackStatus("error");
        setPackError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { messages, sendMessage, status: chatStatus, error: chatError } = useChat({
    transport: chatTransport,
    onFinish: ({ message }) => {
      const nextSource = committedSource(message);
      if (!nextSource) return;
      setSource(nextSource);
      setActiveTab("preview");
      if (pack && modelSettings.builder.autoRunAfterGeneration) void runWith(nextSource, pack);
    },
  });

  const changeVersion = async (nextVersion: string) => {
    if (nextVersion === version) return;
    const entry = VERSION_OPTIONS.find((item) => item.id === nextVersion);
    if (!entry) return;
    const nextSource = source.replace(/version:\s*["'][^"']+["']/, `version: "${nextVersion}"`);
    setVersion(nextVersion);
    setSource(nextSource);
    setPack(null);
    setSelected(null);
    setPackStatus("loading");
    setPackError("");
    if (entry.experimental) {
      setPackStatus("error");
      setPackError(`${nextVersion} 已列入实验通道，但完整方块注册表尚未发布，因此暂不允许执行或导出。`);
      setNotice(`${nextVersion} 实验版本已锁定；等待版本包`);
      return;
    }
    try {
      const loaded = await loadVersionPack(nextVersion);
      setPack(loaded);
      setPackStatus("ready");
      setNotice(`已复制到 Minecraft ${nextVersion} 迁移上下文，正在重新校验…`);
      await runWith(nextSource, loaded);
    } catch (error) {
      setPackStatus("error");
      setPackError(error instanceof Error ? error.message : String(error));
    }
  };

  const submitPrompt = async (value = prompt) => {
    const text = value.trim();
    if (!text || chatStatus === "streaming" || chatStatus === "submitted") return;
    setPrompt("");
    await sendMessage({ text }, { body: { version, source, settings: modelSettings } });
  };

  const updateModelSettings = (settings: ModelSettings) => {
    setModelSettings(settings);
    saveModelSettings(settings);
    setNotice(`模型设置已更新 · ${providerLabel(settings)} · ${settings.model}`);
  };

  const exportLitematic = async () => {
    if (!pack || blockingErrors > 0 || world.blocks.length === 0) return;
    setExporting(true);
    setNotice("正在编码 NBT、打包调色板并执行 GZip…");
    try {
      const blob = await createLitematicBlob(world, pack);
      downloadBlob(blob, safeLitematicName(world.name));
      setNotice(`已导出 ${safeLitematicName(world.name)} · ${(blob.size / 1024).toFixed(1)} KB`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDiagnostics((current) => [
        ...current,
        { severity: "error", stage: "export", code: "EXPORT_FAILED", message },
      ]);
      setNotice("导出被阻止：请查看校验结果");
      setActiveTab("diagnostics");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="builder-shell">
      <ModelSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={modelSettings}
        onSave={updateModelSettings}
      />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-cube" aria-hidden="true"><span /></div>
          <div>
            <div className="brand-name">ForgeScript</div>
            <div className="project-name">{world.name}</div>
          </div>
        </div>

        <div className="topbar-center">
          <label className="version-picker">
            <span>JAVA</span>
            <select value={version} onChange={(event) => void changeVersion(event.target.value)} aria-label="Minecraft 版本">
              <optgroup label="Legacy">
                {VERSION_OPTIONS.filter((item) => ["1.12.2", "1.13.2"].includes(item.id)).map((item) => <option key={item.id}>{item.id}</option>)}
              </optgroup>
              <optgroup label="长期常用版本">
                {VERSION_OPTIONS.filter((item) => ["1.16.5", "1.18.2", "1.19.2", "1.19.4", "1.20.1", "1.20.4", "1.20.6"].includes(item.id)).map((item) => <option key={item.id}>{item.id}</option>)}
              </optgroup>
              <optgroup label="1.21 系列">
                {VERSION_OPTIONS.filter((item) => item.id.startsWith("1.21")).map((item) => <option key={item.id}>{item.id}</option>)}
              </optgroup>
              <optgroup label="实验通道">
                {VERSION_OPTIONS.filter((item) => item.experimental).map((item) => <option key={item.id}>{item.id} · 实验</option>)}
              </optgroup>
            </select>
            <ChevronDown size={13} />
          </label>
          <span className={`profile-state ${packStatus}`}>
            {packStatus === "loading" && <LoaderCircle size={12} className="spin" />}
            {packStatus === "ready" && <Check size={12} />}
            {packStatus === "error" && <CircleAlert size={12} />}
            {packStatus === "ready" ? `${pack?.blockCount.toLocaleString()} BLOCKS` : packStatus.toUpperCase()}
          </span>
        </div>

        <div className="top-actions">
          <button className="icon-button model-settings-trigger" onClick={() => setSettingsOpen(true)} title="模型与生成设置" aria-label="打开模型与生成设置"><Settings2 size={16} /></button>
          <button className="icon-button" disabled title="撤销即将加入历史层"><Undo2 size={16} /></button>
          <button className="icon-button" disabled title="重做即将加入历史层"><Redo2 size={16} /></button>
          <button className="run-button" disabled={!pack || running} onClick={() => pack && void runWith(source, pack)}>
            {running ? <LoaderCircle size={15} className="spin" /> : <Play size={15} fill="currentColor" />}
            运行源码
          </button>
          <button className="export-button" disabled={!pack || blockingErrors > 0 || exporting || world.blocks.length === 0} onClick={() => void exportLitematic()}>
            {exporting ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
            导出 .litematic
          </button>
        </div>
      </header>

      <div className={`workbench-grid ${inspectorOpen ? "with-inspector" : ""}`}>
        <aside className="chat-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ARCHITECT</span>
              <h1>与建筑 AI 对话</h1>
            </div>
            <button className="model-badge" onClick={() => setSettingsOpen(true)} title={`${modelSettings.model} · 点击配置`}>
              <span className="model-status-dot" /><Sparkles size={12} /> {providerLabel(modelSettings)}
            </button>
          </div>

          <Conversation className="conversation">
            <ConversationContent className="conversation-content">
              <Message from="assistant" className="builder-message">
                <div className="assistant-avatar"><Cuboid size={15} /></div>
                <MessageContent className="assistant-message-content">
                  <MessageResponse>
                    {`告诉我你想建什么。我会生成受控 JavaScript，查询 **Minecraft ${version}** 的方块状态，并在预览更新前运行校验。`}
                  </MessageResponse>
                </MessageContent>
              </Message>

              {messages.map((message) => (
                <Message from={message.role} key={message.id} className="builder-message">
                  {message.role === "assistant" && <div className="assistant-avatar"><WandSparkles size={15} /></div>}
                  <MessageContent className={message.role === "user" ? "user-message-content" : "assistant-message-content"}>
                    {messageText(message) && <MessageResponse>{messageText(message)}</MessageResponse>}
                    {message.parts.map((part, index) => {
                      if (part.type !== "tool-commit_source") return null;
                      return (
                        <Tool key={`${message.id}-${index}`} className="source-tool" defaultOpen>
                          <ToolHeader type={part.type} state={part.state} title="建筑源码变更" />
                          <ToolContent>
                            <div className="change-summary">
                              <FileCode2 size={16} />
                              <div><strong>完整源码已提交</strong><span>将在 QuickJS 隔离环境中执行并校验</span></div>
                            </div>
                          </ToolContent>
                        </Tool>
                      );
                    })}
                  </MessageContent>
                </Message>
              ))}

              {(chatStatus === "submitted" || chatStatus === "streaming") && (
                <div className="thinking-row"><LoaderCircle size={14} className="spin" /> 正在查询方块状态并编写结构…</div>
              )}
              {chatError && <div className="chat-error">AI 请求失败：{chatError.message}</div>}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          {messages.length === 0 && (
            <div className="quick-prompts">
              {quickPrompts.map((item) => <button key={item} onClick={() => void submitPrompt(item)}>{item}</button>)}
            </div>
          )}

          <div className="chat-composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submitPrompt();
                }
              }}
              placeholder="例如：做一个 12×9 的云杉小屋，北侧开门…"
              rows={3}
            />
            <div className="composer-footer">
              <span><Zap size={12} /> 选择与版本会自动附带</span>
              <button onClick={() => void submitPrompt()} disabled={!prompt.trim() || chatStatus === "streaming" || chatStatus === "submitted"} aria-label="发送消息"><Send size={15} /></button>
            </div>
          </div>
        </aside>

        <section className="workspace-panel">
          <div className="workspace-tabs">
            <div className="tab-list" role="tablist">
              <button className={activeTab === "preview" ? "active" : ""} onClick={() => setActiveTab("preview")}><Box size={14} />3D 预览</button>
              <button className={activeTab === "source" ? "active" : ""} onClick={() => setActiveTab("source")}><Code2 size={14} />JavaScript</button>
              <button className={activeTab === "diagnostics" ? "active" : ""} onClick={() => setActiveTab("diagnostics")}><CircleAlert size={14} />校验 <span className={blockingErrors ? "error-count" : "ok-count"}>{blockingErrors || warnings}</span></button>
            </div>
            <div className="view-actions">
              {activeTab === "preview" && <>
                <button className={xray ? "active" : ""} onClick={() => setXray((value) => !value)} title="X-Ray">{xray ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                <button className={redstoneOnly ? "active redstone" : ""} onClick={() => setRedstoneOnly((value) => !value)} title="仅红石"><Zap size={14} /></button>
                <button className={layer !== null ? "active" : ""} onClick={() => setLayer((value) => value === null ? maxY : null)} title="Y 层切片"><Layers3 size={14} /></button>
              </>}
              <button className={inspectorOpen ? "active" : ""} onClick={() => setInspectorOpen((value) => !value)} title="检查器"><PanelRight size={14} /></button>
            </div>
          </div>

          <div className="workspace-content">
            {activeTab === "preview" && (
              <div className="preview-surface">
                <Viewport3D world={world} xray={xray} redstoneOnly={redstoneOnly} layer={layer} selected={selected} onSelect={setSelected} />
                <div className="preview-overlay top-left">
                  <span className="axis x">X</span><span className="axis y">Y</span><span className="axis z">Z</span>
                  <span>{stats.size.join(" × ")} blocks</span>
                </div>
                {layer !== null && (
                  <div className="layer-control">
                    <label>Y ≤ {layer}</label>
                    <input type="range" min={Math.min(0, ...world.blocks.map((block) => block.y))} max={maxY} value={layer} onChange={(event) => setLayer(Number(event.target.value))} />
                  </div>
                )}
                {world.blocks.length > 12_000 && <div className="preview-overlay bottom-left">大型结构预览已抽样；导出仍保留全部方块</div>}
              </div>
            )}

            {activeTab === "source" && (
              <div className="source-surface">
                <div className="source-meta"><span><Braces size={13} /> build.js</span><span>{lineCount(source)} lines · QuickJS sandbox</span></div>
                <div className="editor-wrap">
                  <div className="line-numbers" aria-hidden="true">{Array.from({ length: lineCount(source) }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
                  <textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} aria-label="建筑 JavaScript 源码" />
                </div>
              </div>
            )}

            {activeTab === "diagnostics" && (
              <div className="diagnostics-surface">
                <div className="diagnostic-summary">
                  <div className={blockingErrors ? "summary-icon error" : "summary-icon success"}>{blockingErrors ? <CircleAlert /> : <Check />}</div>
                  <div><h2>{blockingErrors ? `${blockingErrors} 个问题阻止导出` : "结构校验通过"}</h2><p>{warnings} 个警告 · 版本 {version} · {pack?.blockCount.toLocaleString() ?? 0} 个方块定义</p></div>
                </div>
                <div className="diagnostic-list">
                  {packError && <article className="diagnostic-card error"><CircleAlert size={17} /><div><strong>VERSION_PACK</strong><p>{packError}</p></div></article>}
                  {diagnostics.length === 0 && !packError && <div className="empty-diagnostics"><Check size={28} /><strong>没有发现状态或结构错误</strong><span>导出时还会再次编码并执行基础 NBT 自检。</span></div>}
                  {diagnostics.map((item, index) => (
                    <article key={`${item.code}-${index}`} className={`diagnostic-card ${item.severity}`}>
                      <CircleAlert size={17} />
                      <div><strong>{item.code}</strong><p>{item.message}</p>{item.block && <span>{item.block.region} · {item.block.x}, {item.block.y}, {item.block.z}</span>}</div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>

          <footer className="statusbar">
            <span className={blockingErrors ? "status-dot error" : "status-dot"} />
            <span>{notice}</span>
            <span className="status-spacer" />
            <span>{formatBytes(VERSION_OPTIONS.find((item) => item.id === version)?.bytes ?? 0)} profile</span>
            <span>{stats.blockCount.toLocaleString()} blocks</span>
          </footer>
        </section>

        {inspectorOpen && (
          <aside className="inspector-panel">
            <div className="inspector-heading"><span className="eyebrow">INSPECTOR</span><h2>{selected ? "方块状态" : "结构概览"}</h2></div>
            {selected ? (
              <div className="inspector-section selected-block">
                <div className="block-swatch" style={{ background: /redstone/.test(selected.state.id) ? "#b84d44" : "#69736d" }}><Cuboid /></div>
                <strong>{selected.state.id.replace("minecraft:", "")}</strong>
                <span>{selected.x}, {selected.y}, {selected.z}</span>
                <dl>
                  {Object.entries(selected.state.properties).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
                  {Object.keys(selected.state.properties).length === 0 && <div><dt>properties</dt><dd>default</dd></div>}
                </dl>
              </div>
            ) : (
              <>
                <div className="metric-grid">
                  <div><span>方块</span><strong>{stats.blockCount.toLocaleString()}</strong></div>
                  <div><span>调色板</span><strong>{stats.paletteSize}</strong></div>
                  <div><span>尺寸</span><strong>{stats.size.join("×")}</strong></div>
                  <div><span>体积</span><strong>{stats.volume.toLocaleString()}</strong></div>
                </div>
                <div className="inspector-section">
                  <div className="section-title"><span>材料表</span><small>TOP {Math.min(8, stats.materials.length)}</small></div>
                  <div className="materials-list">
                    {stats.materials.slice(0, 8).map((material) => (
                      <div key={material.id}><span className="material-dot" /><span title={material.id}>{material.id.replace("minecraft:", "")}</span><strong>{material.count.toLocaleString()}</strong></div>
                    ))}
                  </div>
                </div>
                <div className="inspector-section version-card">
                  <div className="section-title"><span>版本包</span><small>{packStatus === "ready" ? "LOADED" : packStatus.toUpperCase()}</small></div>
                  <strong>Minecraft Java {version}</strong>
                  <p>{pack ? `${pack.blockCount.toLocaleString()} 个完整方块定义，DataVersion ${pack.dataVersion}` : packError || "正在按需加载…"}</p>
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
