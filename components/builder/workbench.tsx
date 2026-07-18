"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { ChatAddToolOutputFunction, FileUIPart } from "ai";
import {
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Code2,
  Cuboid,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  ImagePlus,
  Layers3,
  LoaderCircle,
  MessageSquarePlus,
  PanelRight,
  PackageOpen,
  Pencil,
  Play,
  Redo2,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Undo2,
  X,
  WandSparkles,
  Zap,
} from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
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
import dynamic from "next/dynamic";
const Viewport3D = dynamic(
  () => import("./viewport-3d").then((mod) => mod.Viewport3D),
  { ssr: false }
);
import { ModelSettingsDialog } from "./model-settings-dialog";
import { ResourcePackDialog } from "./resource-pack-dialog";
import {
  DEFAULT_MODEL_SETTINGS,
  loadModelProfiles,
  providerLabel,
  saveModelProfiles,
  type ModelProfile,
  type ModelSettings,
} from "@/lib/ai/model-settings";
import {
  commitSourceInputSchema,
  commitSourceOutputSchema,
  latestCommitOutput,
  type BuilderUIMessage,
  type CommitSourceOutput,
} from "@/lib/ai/agent-protocol";
import { loadAgentSession, saveAgentSession } from "@/lib/ai/agent-persistence";
import { preflightBuilderSource } from "@/lib/ai/source-preflight";
import { DEFAULT_SOURCE } from "@/lib/minecraft/demo-source";
import { createLitematicBlob, safeLitematicName } from "@/lib/minecraft/litematic";
import { executeBuilderSource } from "@/lib/minecraft/runner";
import {
  listResourcePacks,
  saveResourcePackConfiguration,
  type ResourcePackSummary,
} from "@/lib/minecraft/resource-packs";
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
type AgentRunStatus = "idle" | "generating" | "validating" | "repairing" | "succeeded" | "failed" | "exhausted" | "cancelled";
type AgentRunState = {
  id: string | null;
  status: AgentRunStatus;
  attempt: number;
  maxAttempts: number;
  error?: string;
};

const EMPTY_WORLD: WorldDocument = {
  name: "空白项目",
  version: "1.21.11",
  author: "LLM MC Builder",
  description: "",
  blocks: [],
};

const quickPrompts = ["生成一座云杉生存小屋", "设计可调延迟红石链", "建造一座铜顶瞭望塔"];

function messageText(message: BuilderUIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function committedSource(message: BuilderUIMessage): string | null {
  for (const part of message.parts) {
    if (part.type !== "tool-commit_source" || !("input" in part)) continue;
    const output = "output" in part ? part.output as { accepted?: unknown } | undefined : undefined;
    if (output?.accepted !== true) continue;
    const input = part.input as { source?: unknown } | undefined;
    if (typeof input?.source === "string") return input.source;
  }
  return null;
}

function messageImages(message: BuilderUIMessage) {
  return message.parts.filter((part): part is FileUIPart =>
    part.type === "file" && part.mediaType.startsWith("image/"),
  );
}

function sourceBeforeMessage(messages: BuilderUIMessage[], messageId: string) {
  let historicalSource = DEFAULT_SOURCE;
  for (const message of messages) {
    if (message.id === messageId) return historicalSource;
    historicalSource = committedSource(message) ?? historicalSource;
  }
  return historicalSource;
}

function fileToUIPart(file: File): Promise<FileUIPart> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取图片 ${file.name}`));
    reader.onload = () => resolve({
      type: "file",
      mediaType: file.type,
      filename: file.name,
      url: String(reader.result),
    });
    reader.readAsDataURL(file);
  });
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
  const [resourcePackOpen, setResourcePackOpen] = useState(false);
  const [resourcePacks, setResourcePacks] = useState<ResourcePackSummary[]>([]);
  const [modelSettings, setModelSettings] = useState<ModelSettings>(DEFAULT_MODEL_SETTINGS);
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([
    { id: "default", name: "默认配置", settings: DEFAULT_MODEL_SETTINGS, updatedAt: 0 },
  ]);
  const [activeProfileId, setActiveProfileId] = useState("default");
  const [attachments, setAttachments] = useState<FileUIPart[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [notice, setNotice] = useState("正在载入版本化方块注册表…");
  const [agentRun, setAgentRun] = useState<AgentRunState>({
    id: null,
    status: "idle",
    attempt: 0,
    maxAttempts: 1,
  });
  const executionTimeoutRef = useRef(DEFAULT_MODEL_SETTINGS.builder.executionTimeoutMs);
  const maxBuildBlocksRef = useRef(DEFAULT_MODEL_SETTINGS.builder.maxBuildBlocks);
  const activeRunRef = useRef<{ id: string; attempt: number; maxAttempts: number } | null>(null);
  const addToolOutputRef = useRef<ChatAddToolOutputFunction<BuilderUIMessage> | null>(null);
  const packRef = useRef<VersionPack | null>(null);
  const sourceSnapshotsRef = useRef<Record<string, { source: string; version: string }>>({});
  const persistenceReadyRef = useRef(false);
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialVersionRef = useRef(version);
  const restoredSourceToRunRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => getWorldStats(world), [world]);
  const maxY = useMemo(
    () => (world.blocks.length ? Math.max(...world.blocks.map((block) => block.y)) : 0),
    [world],
  );
  const blockingErrors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  const chatTransport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);

  const evaluateSource = useCallback(async (nextSource: string, nextPack: VersionPack) => {
    try {
      const nextWorld = await executeBuilderSource(nextSource, {
        timeoutMs: executionTimeoutRef.current,
      });
      const sizeDiagnostics: Diagnostic[] = nextWorld.blocks.length > maxBuildBlocksRef.current
        ? [{
            severity: "error",
            stage: "structure",
            code: "BUILD_BLOCK_LIMIT_EXCEEDED",
            message: `结构包含 ${nextWorld.blocks.length.toLocaleString()} 个方块，超过配置上限 ${maxBuildBlocksRef.current.toLocaleString()}`,
          }]
        : [];
      const nextDiagnostics = [...sizeDiagnostics, ...validateWorld(nextWorld, nextPack)];
      return {
        world: nextWorld,
        diagnostics: nextDiagnostics,
        errors: nextDiagnostics.filter((item) => item.severity === "error"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const runtimeDiagnostics: Diagnostic[] = [{
        severity: "error",
        stage: "runtime",
        code: "SCRIPT_RUNTIME_ERROR",
        message,
      }];
      return { world: null, diagnostics: runtimeDiagnostics, errors: runtimeDiagnostics };
    }
  }, []);

  const runWith = useCallback(async (nextSource: string, nextPack: VersionPack) => {
    setRunning(true);
    setNotice("QuickJS 沙箱正在执行建筑脚本…");
    try {
      const result = await evaluateSource(nextSource, nextPack);
      setDiagnostics(result.diagnostics);
      if (result.world) {
        setWorld(result.world);
        setSelected(null);
      }
      if (result.errors.length > 0) {
        setNotice(result.world
          ? `运行完成，但发现 ${result.errors.length} 个阻断错误`
          : "源码运行失败；已保留上一次成功预览");
        setActiveTab("diagnostics");
      } else if (result.world) {
        setNotice(`运行成功 · ${result.world.blocks.length.toLocaleString()} 个方块 · ${nextPack.blockCount.toLocaleString()} 个版本方块可用`);
      }
      return result.errors;
    } finally {
      setRunning(false);
    }
  }, [evaluateSource]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const loaded = loadModelProfiles();
      const active = loaded.profiles.find((profile) => profile.id === loaded.activeProfileId) ?? loaded.profiles[0];
      executionTimeoutRef.current = active.settings.builder.executionTimeoutMs;
      maxBuildBlocksRef.current = active.settings.builder.maxBuildBlocks;
      setModelProfiles(loaded.profiles);
      setActiveProfileId(active.id);
      setModelSettings(active.settings);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listResourcePacks()
      .then((loaded) => {
        if (!cancelled) setResourcePacks(loaded);
      })
      .catch((error) => {
        if (!cancelled) setNotice(`无法读取本地资源包：${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const entry = VERSION_OPTIONS.find((item) => item.id === version);
    packRef.current = null;
    if (!entry || entry.experimental) {
      return () => {
        cancelled = true;
      };
    }
    loadVersionPack(version)
      .then((loaded) => {
        if (cancelled) return;
        setPack(loaded);
        packRef.current = loaded;
        setPackStatus("ready");
        setNotice(`Minecraft ${version} 已就绪 · ${loaded.blockCount.toLocaleString()} 个版本方块可用`);
        const restoredSource = restoredSourceToRunRef.current;
        if (restoredSource) {
          restoredSourceToRunRef.current = null;
          void runWith(restoredSource, loaded);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setPackStatus("error");
        setPackError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [runWith, version]);

  const {
    messages,
    sendMessage,
    setMessages,
    stop,
    addToolOutput,
    status: chatStatus,
    error: chatError,
  } = useChat<BuilderUIMessage>({
    transport: chatTransport,
    sendAutomaticallyWhen: ({ messages: nextMessages }) => (
      activeRunRef.current !== null
      && lastAssistantMessageIsCompleteWithToolCalls({ messages: nextMessages })
    ),
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName !== "commit_source") return;
      const activeRun = activeRunRef.current;
      if (!activeRun) return;
      const parsedInput = commitSourceInputSchema.safeParse(toolCall.input);
      if (!parsedInput.success) {
        const output: CommitSourceOutput = {
          accepted: false,
          stage: "structure",
          error: "模型提交的 commit_source 参数无效",
          terminal: true,
          attempt: activeRun.attempt + 1,
          maxAttempts: activeRun.maxAttempts,
        };
        setAgentRun({ ...activeRun, status: "failed", attempt: output.attempt ?? 1, error: output.error });
        void addToolOutputRef.current?.({
          tool: "commit_source",
          toolCallId: toolCall.toolCallId,
          output,
          options: { body: { version, source, settings: modelSettings } },
        });
        return;
      }

      const { source: nextSource, summary, version: claimedVersion } = parsedInput.data;
      const attempt = activeRun.attempt + 1;
      activeRunRef.current = { ...activeRun, attempt };
      setAgentRun({ ...activeRun, status: "validating", attempt });
      setRunning(true);
      setNotice(`Agent 正在执行第 ${attempt}/${activeRun.maxAttempts} 次完整校验…`);

      const returnFailure = (failure: Omit<CommitSourceOutput, "accepted" | "attempt" | "maxAttempts">) => {
        const exhausted = attempt >= activeRun.maxAttempts;
        const output = commitSourceOutputSchema.parse({
          accepted: false,
          ...failure,
          terminal: exhausted || failure.terminal === true,
          exhausted,
          attempt,
          maxAttempts: activeRun.maxAttempts,
        });
        setAgentRun({
          ...activeRun,
          status: exhausted ? "exhausted" : "repairing",
          attempt,
          error: output.error,
        });
        setNotice(exhausted
          ? `Agent 在 ${activeRun.maxAttempts} 次完整校验后仍未收敛`
          : `第 ${attempt} 次校验未通过，Agent 正在依据工具结果继续修正…`);
        void addToolOutputRef.current?.({
          tool: "commit_source",
          toolCallId: toolCall.toolCallId,
          output,
          options: { body: { version: claimedVersion, source, settings: modelSettings } },
        });
      };

      try {
        if (claimedVersion !== version) {
          returnFailure({
            stage: "metadata",
            error: `源码声明版本 ${claimedVersion}，但当前工作区目标版本是 ${version}`,
          });
          return;
        }

        const preflight = preflightBuilderSource(
          nextSource,
          claimedVersion,
          maxBuildBlocksRef.current,
        );
        if (!preflight.accepted) {
          returnFailure(preflight);
          return;
        }

        const validationPack = packRef.current?.gameVersion === claimedVersion
          ? packRef.current
          : await loadVersionPack(claimedVersion);
        if (activeRunRef.current?.id !== activeRun.id) return;
        const evaluation = await evaluateSource(nextSource, validationPack);
        if (activeRunRef.current?.id !== activeRun.id) return;

        setDiagnostics(evaluation.diagnostics);
        if (evaluation.errors.length > 0 || !evaluation.world) {
          const errorReport = evaluation.errors.slice(0, 40).map((diagnostic, index) => (
            `${index + 1}. [${diagnostic.code}] ${diagnostic.message}${diagnostic.block
              ? ` @ ${diagnostic.block.x},${diagnostic.block.y},${diagnostic.block.z}`
              : ""}`
          )).join("\n");
          returnFailure({
            stage: evaluation.errors.some((item) => item.stage === "runtime") ? "runtime" : "registry",
            error: errorReport.slice(0, 20_000),
          });
          setActiveTab("diagnostics");
          return;
        }

        const nextStats = getWorldStats(evaluation.world);
        setSource(nextSource);
        setSelected(null);
        if (modelSettings.builder.autoRunAfterGeneration) {
          setWorld(evaluation.world);
          setActiveTab("preview");
        } else {
          setActiveTab("source");
        }
        const output = commitSourceOutputSchema.parse({
          ...preflight,
          summary,
          stage: "registry",
          terminal: true,
          attempt,
          maxAttempts: activeRun.maxAttempts,
          validation: {
            ...preflight.validation,
            blockCount: nextStats.blockCount,
            paletteSize: nextStats.paletteSize,
            size: nextStats.size,
          },
        });
        setAgentRun({ ...activeRun, status: "succeeded", attempt });
        setNotice(`Agent 完整校验通过 · ${nextStats.blockCount.toLocaleString()} 个方块 · 第 ${attempt} 次提交`);
        void addToolOutputRef.current?.({
          tool: "commit_source",
          toolCallId: toolCall.toolCallId,
          output,
          options: { body: { version: claimedVersion, source: nextSource, settings: modelSettings } },
        });
      } catch (error) {
        if (activeRunRef.current?.id !== activeRun.id) return;
        returnFailure({
          stage: "runtime",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (activeRunRef.current?.id === activeRun.id) setRunning(false);
      }
    },
    onFinish: ({ message, messages: nextMessages, isAbort, isError }) => {
      if (isAbort) return;
      const activeRun = activeRunRef.current;
      if (!activeRun) return;
      const lastStepStartIndex = message.parts.reduce(
        (lastIndex, part, index) => part.type === "step-start" ? index : lastIndex,
        -1,
      );
      const toolParts = message.parts
        .slice(lastStepStartIndex + 1)
        .filter((part) => part.type === "tool-commit_source");
      const invalidToolPart = toolParts.find((part) => part.state === "output-error");
      if (invalidToolPart) {
        const attempt = activeRun.attempt + 1;
        const exhausted = attempt >= activeRun.maxAttempts;
        if (exhausted) activeRunRef.current = null;
        else activeRunRef.current = { ...activeRun, attempt };
        setAgentRun({
          ...activeRun,
          status: exhausted ? "exhausted" : "repairing",
          attempt,
          error: invalidToolPart.errorText,
        });
        setNotice(exhausted
          ? `Agent 连续提交无效工具参数，已在 ${activeRun.maxAttempts} 次后停止`
          : `第 ${attempt} 次工具参数无效，Agent 正在修正…`);
        return;
      }
      if (toolParts.length > 0) return;
      const terminal = latestCommitOutput(nextMessages);
      if (isError || !terminal) {
        setAgentRun({ ...activeRun, status: "failed", error: "模型未提交可验证的完整源码" });
        setNotice("Agent 已停止：模型未提交可验证的完整源码");
      } else if (terminal.accepted) {
        setAgentRun({ ...activeRun, status: "succeeded", attempt: activeRun.attempt });
      } else if (terminal.exhausted) {
        setAgentRun({ ...activeRun, status: "exhausted", attempt: activeRun.attempt, error: terminal.error });
      } else {
        setAgentRun({ ...activeRun, status: "failed", attempt: activeRun.attempt, error: terminal.error });
      }
      activeRunRef.current = null;
    },
    onError: (error) => {
      const activeRun = activeRunRef.current;
      if (!activeRun) return;
      setAgentRun({ ...activeRun, status: "failed", error: error.message });
      setNotice(`Agent 请求失败：${error.message}`);
      activeRunRef.current = null;
    },
  });

  useEffect(() => {
    addToolOutputRef.current = addToolOutput;
    return () => {
      addToolOutputRef.current = null;
    };
  }, [addToolOutput]);

  const beginAgentRun = () => {
    const id = crypto.randomUUID();
    const maxAttempts = Math.max(
      1,
      Math.min(
        modelSettings.generation.maxSteps,
        modelSettings.builder.maxAutoFixAttempts + 1,
      ),
    );
    activeRunRef.current = { id, attempt: 0, maxAttempts };
    setAgentRun({ id, status: "generating", attempt: 0, maxAttempts });
    return id;
  };

  const cancelAgentRun = async (message = "Agent 运行已取消") => {
    if (!activeRunRef.current && chatStatus !== "streaming" && chatStatus !== "submitted") return;
    const current = activeRunRef.current;
    activeRunRef.current = null;
    setRunning(false);
    setAgentRun({
      id: current?.id ?? null,
      status: "cancelled",
      attempt: current?.attempt ?? 0,
      maxAttempts: current?.maxAttempts ?? 1,
    });
    setNotice(message);
    await stop();
  };

  const changeVersion = async (nextVersion: string) => {
    if (nextVersion === version) return;
    const entry = VERSION_OPTIONS.find((item) => item.id === nextVersion);
    if (!entry) return;
    await cancelAgentRun("版本已切换，当前 Agent 运行已取消");
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
    setNotice(`已切换到 Minecraft ${nextVersion}，正在加载版本包…`);
  };

  const submitPrompt = async (value = prompt) => {
    const text = value.trim();
    if (!text || chatStatus === "streaming" || chatStatus === "submitted") return;
    setPrompt("");
    const files = attachments;
    setAttachments([]);
    const messageId = crypto.randomUUID();
    sourceSnapshotsRef.current[messageId] = { source, version };
    beginAgentRun();
    await sendMessage(
      {
        id: messageId,
        role: "user",
        parts: [...files, { type: "text", text }],
      },
      { body: { version, source, settings: modelSettings } },
    );
  };

  const retryUserMessage = async (message: BuilderUIMessage) => {
    if (chatStatus === "streaming" || chatStatus === "submitted") return;
    const snapshot = sourceSnapshotsRef.current[message.id] ?? {
      source: sourceBeforeMessage(messages, message.id),
      version,
    };
    sourceSnapshotsRef.current[message.id] = snapshot;
    setSource(snapshot.source);
    setVersion(snapshot.version);
    beginAgentRun();
    setNotice("正在从这条用户消息重新运行 Agent…");
    await sendMessage(
      { text: messageText(message), files: messageImages(message), messageId: message.id },
      { body: { version: snapshot.version, source: snapshot.source, settings: modelSettings } },
    );
  };

  const saveEditedMessage = async (message: BuilderUIMessage) => {
    const text = editingText.trim();
    if (!text || chatStatus === "streaming" || chatStatus === "submitted") return;
    setEditingMessageId(null);
    const snapshot = sourceSnapshotsRef.current[message.id] ?? {
      source: sourceBeforeMessage(messages, message.id),
      version,
    };
    sourceSnapshotsRef.current[message.id] = snapshot;
    setSource(snapshot.source);
    setVersion(snapshot.version);
    beginAgentRun();
    setNotice("已修改消息，正在重新运行后续 Agent 流程…");
    await sendMessage(
      { text, files: messageImages(message), messageId: message.id },
      { body: { version: snapshot.version, source: snapshot.source, settings: modelSettings } },
    );
  };

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!modelSettings.capabilities.vision) {
      setNotice("当前模型配置未启用视觉输入，请先在模型设置中开启");
      return;
    }
    const candidates = Array.from(files).filter((file) =>
      ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type),
    );
    const oversized = candidates.find((file) => file.size > 8 * 1024 * 1024);
    if (oversized) {
      setNotice(`${oversized.name} 超过 8 MB，未添加`);
      return;
    }
    const available = Math.max(0, 4 - attachments.length);
    if (available === 0) {
      setNotice("每条消息最多上传 4 张图片");
      return;
    }
    try {
      const parts = await Promise.all(candidates.slice(0, available).map(fileToUIPart));
      setAttachments((current) => [...current, ...parts].slice(0, 4));
      if (candidates.length > available) setNotice("每条消息最多上传 4 张图片，其余图片未添加");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadAgentSession()
      .then((session) => {
        if (cancelled) return;
        if (session) {
          const restoredMessages = session.messages.filter((message) => !message.parts.some((part) => (
            part.type === "tool-commit_source"
            && (part.state === "input-available" || part.state === "input-streaming")
          )));
          sourceSnapshotsRef.current = session.sourceSnapshots;
          setMessages(restoredMessages);
          setSource(session.source);
          const restoredEntry = VERSION_OPTIONS.find((item) => item.id === session.version);
          if (session.version !== initialVersionRef.current) {
            setPack(null);
            packRef.current = null;
            setPackStatus(restoredEntry && !restoredEntry.experimental ? "loading" : "error");
            setPackError(restoredEntry && !restoredEntry.experimental ? "" : `${session.version} 的完整方块版本包尚未发布`);
          }
          setVersion(session.version);
          if (packRef.current?.gameVersion === session.version) {
            void runWith(session.source, packRef.current);
          } else if (restoredEntry && !restoredEntry.experimental) {
            restoredSourceToRunRef.current = session.source;
          }
          setNotice(`已恢复本地 Agent 会话 · ${restoredMessages.length} 条消息`);
        }
        persistenceReadyRef.current = true;
      })
      .catch((error) => {
        if (cancelled) return;
        persistenceReadyRef.current = true;
        setNotice(`无法恢复本地 Agent 会话：${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [runWith, setMessages]);

  useEffect(() => {
    if (!persistenceReadyRef.current) return;
    if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
    persistenceTimerRef.current = setTimeout(() => {
      void saveAgentSession({
        messages,
        source,
        version,
        sourceSnapshots: sourceSnapshotsRef.current,
      }).catch((error) => {
        setNotice(`Agent 会话持久化失败：${error instanceof Error ? error.message : String(error)}`);
      });
    }, 250);
    return () => {
      if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
    };
  }, [messages, source, version]);

  const startNewConversation = async () => {
    await cancelAgentRun("正在结束当前 Agent 运行…");
    sourceSnapshotsRef.current = {};
    setMessages([]);
    setPrompt("");
    setAttachments([]);
    setEditingMessageId(null);
    setAgentRun({ id: null, status: "idle", attempt: 0, maxAttempts: 1 });
    setNotice("已开启新对话 · 当前建筑源码与预览保持不变");
  };

  const updateModelSettings = (profiles: ModelProfile[], nextActiveProfileId: string) => {
    const active = profiles.find((profile) => profile.id === nextActiveProfileId) ?? profiles[0];
    saveModelProfiles(profiles, active.id);
    executionTimeoutRef.current = active.settings.builder.executionTimeoutMs;
    maxBuildBlocksRef.current = active.settings.builder.maxBuildBlocks;
    setModelProfiles(profiles);
    setActiveProfileId(active.id);
    setModelSettings(active.settings);
    setAttachments([]);
    setNotice(`模型预设已保存 · ${active.name} · ${providerLabel(active.settings)} · ${active.settings.model}`);
  };

  const applyResourcePacks = useCallback(async (nextPacks: ResourcePackSummary[]) => {
    await saveResourcePackConfiguration(nextPacks);
    const refreshed = await listResourcePacks();
    setResourcePacks(refreshed);
    const enabledCount = refreshed.filter((item) => item.enabled).length;
    setNotice(enabledCount > 0
      ? `资源包栈已更新 · ${enabledCount} 个资源包生效 · 顶部优先`
      : "资源包栈已清空 · 使用真实形状与程序化材质");
  }, []);

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
        profiles={modelProfiles}
        activeProfileId={activeProfileId}
        onSave={updateModelSettings}
      />
      <ResourcePackDialog
        open={resourcePackOpen}
        onOpenChange={setResourcePackOpen}
        packs={resourcePacks}
        gameVersion={version}
        targetFormat={pack?.resourcePackFormat ?? null}
        onApply={applyResourcePacks}
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
          <button className="icon-button resource-pack-trigger" onClick={() => setResourcePackOpen(true)} title="资源包" aria-label="打开资源包管理器">
            <PackageOpen size={16} />
            {resourcePacks.some((item) => item.enabled) && <span>{resourcePacks.filter((item) => item.enabled).length}</span>}
          </button>
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
            <div className="panel-heading-actions">
              <button
                className="new-chat-button"
                onClick={() => void startNewConversation()}
                title="开启新对话（保留当前建筑）"
                aria-label="开启新对话（保留当前建筑）"
              >
                <MessageSquarePlus size={14} />
                <span>新对话</span>
              </button>
              <button className="model-badge" onClick={() => setSettingsOpen(true)} title={`${modelSettings.model} · 点击配置`}>
                <span className="model-status-dot" /><Sparkles size={12} /> {providerLabel(modelSettings)}
              </button>
            </div>
          </div>

          {agentRun.status !== "idle" && (
            <div className={`agent-run-state ${agentRun.status}`} role="status" aria-live="polite">
              <span className="status-dot" />
              <span>
                {agentRun.status === "generating" && "Agent 正在生成候选源码"}
                {agentRun.status === "validating" && `Agent 正在完整校验 ${agentRun.attempt}/${agentRun.maxAttempts}`}
                {agentRun.status === "repairing" && `Agent 正在修正 ${agentRun.attempt}/${agentRun.maxAttempts}`}
                {agentRun.status === "succeeded" && `Agent 已验证成功（第 ${agentRun.attempt} 次提交）`}
                {agentRun.status === "exhausted" && `Agent 未收敛（已用 ${agentRun.attempt}/${agentRun.maxAttempts} 次）`}
                {agentRun.status === "failed" && "Agent 运行失败"}
                {agentRun.status === "cancelled" && "Agent 运行已取消"}
              </span>
              {(chatStatus === "submitted" || chatStatus === "streaming" || running) && (
                <button type="button" onClick={() => void cancelAgentRun()}><Square size={10} />停止</button>
              )}
            </div>
          )}

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

              {messages.map((message) => {
                // 如果是隐藏的自动修正消息，则在渲染时完全跳过不展示在 UI 中
                const isAutoFixMessage = message.role === "user" && message.metadata && (message.metadata as { isAutoFix?: boolean }).isAutoFix;
                if (isAutoFixMessage) return null;

                return (
                  <Message from={message.role} key={message.id} className="builder-message">
                    {message.role === "assistant" && <div className="assistant-avatar"><WandSparkles size={15} /></div>}
                    {message.role === "user" ? (
                      <div className="user-message-stack">
                        {editingMessageId === message.id ? (
                          <div className="message-editor">
                            <textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} rows={4} autoFocus />
                            <div>
                              <button type="button" onClick={() => setEditingMessageId(null)}>取消</button>
                              <button type="button" className="primary" onClick={() => void saveEditedMessage(message)} disabled={!editingText.trim()}>保存并重试</button>
                            </div>
                          </div>
                        ) : (
                          <MessageContent className="user-message-content">
                            {messageImages(message).length > 0 && (
                              <div className="message-images">
                                {messageImages(message).map((image, index) => (
                                  <img key={`${message.id}-image-${index}`} src={image.url} alt={image.filename || `参考图片 ${index + 1}`} />
                                ))}
                              </div>
                            )}
                            {messageText(message) && <MessageResponse>{messageText(message)}</MessageResponse>}
                          </MessageContent>
                        )}
                        <div className="user-message-actions">
                          <button type="button" onClick={() => void retryUserMessage(message)} disabled={chatStatus === "streaming" || chatStatus === "submitted"} title="从此消息重新生成"><RefreshCw size={11} />重试</button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMessageId(message.id);
                              setEditingText(messageText(message));
                            }}
                            disabled={chatStatus === "streaming" || chatStatus === "submitted"}
                            title="修改后重新生成"
                          ><Pencil size={11} />修改</button>
                        </div>
                      </div>
                    ) : (
                      <MessageContent className="assistant-message-content">
                        {message.parts.some((part) => part.type === "reasoning") && (
                          <Collapsible className="reasoning-collapsible">
                            <CollapsibleTrigger>
                              <span><ChevronRight size={12} />AI 推理摘要</span>
                              <small>模型提供</small>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              {message.parts
                                .filter((part) => part.type === "reasoning")
                                .map((part) => part.text)
                                .join("")}
                            </CollapsibleContent>
                          </Collapsible>
                        )}

                        {messageText(message) && <MessageResponse>{messageText(message)}</MessageResponse>}
                        {message.parts.map((part, index) => {
                          if (part.type !== "tool-commit_source") return null;
                          const parsedOutput = "output" in part
                            ? commitSourceOutputSchema.safeParse(part.output)
                            : null;
                          const output = parsedOutput?.success ? parsedOutput.data : undefined;
                          const accepted = output?.accepted;
                          const terminalFailure = accepted === false && output?.terminal === true;
                          const validationSummary = output?.validation?.blockCount !== undefined
                            ? `${output.validation.blockCount.toLocaleString()} 方块 · ${output.validation.paletteSize} 种状态 · ${output.validation.size?.join("×")}`
                            : output?.validation
                              ? `${output.validation.regionCount ?? 0} 个区域 · ${output.validation.operationCount ?? 0} 个构建操作 · Java ${output.validation.declaredVersion}`
                              : "安全规则、SDK 结构与版本元数据检查";
                          return (
                            <Tool key={`${message.id}-${index}`} className={`source-tool ${accepted === false ? "is-rejected" : accepted === true ? "is-accepted" : ""}`} defaultOpen={accepted === false}>
                              <ToolHeader
                                type={part.type}
                                state={part.state}
                                title={accepted === true
                                  ? "Agent 完整校验通过"
                                  : terminalFailure
                                    ? "Agent 修正未收敛"
                                    : accepted === false
                                      ? "Agent 收到错误并继续修正"
                                      : "Agent 正在校验源码"}
                                statusLabel={accepted === true ? "Validated" : terminalFailure ? "Failed" : accepted === false ? "Retrying" : undefined}
                                statusVariant={accepted === true ? "success" : terminalFailure ? "error" : accepted === false ? "warning" : "default"}
                              />
                              <ToolContent>
                                <div className="change-summary">
                                  {accepted === false ? <CircleAlert size={16} /> : <FileCode2 size={16} />}
                                  <div>
                                    <strong>{accepted === true
                                      ? "完整源码已通过 AST、QuickJS 与版本注册表校验"
                                      : terminalFailure
                                        ? "已达到修正上限，本次运行失败"
                                        : accepted === false
                                          ? "本次提交未通过，错误已回传给模型"
                                          : "正在执行 AST、QuickJS 与版本注册表校验"}</strong>
                                    <span>
                                      {output?.error ?? validationSummary}
                                    </span>
                                  </div>
                                </div>
                              </ToolContent>
                            </Tool>
                          );
                        })}
                      </MessageContent>
                    )}
                  </Message>
                );
              })}

              {(chatStatus === "submitted" || chatStatus === "streaming") && (
                <div className="thinking-row"><LoaderCircle size={14} className="spin" /> Agent 正在生成、验证或依据工具结果修正…</div>
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
            {attachments.length > 0 && (
              <div className="composer-attachments">
                {attachments.map((image, index) => (
                  <div key={`${image.filename}-${index}`}>
                    <img src={image.url} alt={image.filename || `待发送图片 ${index + 1}`} />
                    <button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`移除 ${image.filename || "图片"}`}><X size={11} /></button>
                  </div>
                ))}
              </div>
            )}
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
              <div className="composer-tools">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  onChange={(event) => void addImages(event.target.files)}
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="attach-button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={!modelSettings.capabilities.vision || attachments.length >= 4}
                  title={modelSettings.capabilities.vision ? "上传参考图片" : "当前模型未启用视觉输入"}
                  aria-label="上传参考图片"
                ><ImagePlus size={14} /></button>
                <span><Zap size={12} /> {modelSettings.capabilities.vision ? "支持视觉输入" : "版本上下文已附带"}</span>
              </div>
              {(chatStatus === "streaming" || chatStatus === "submitted" || running) ? (
                <button onClick={() => void cancelAgentRun()} aria-label="停止 Agent"><Square size={14} /></button>
              ) : (
                <button onClick={() => void submitPrompt()} disabled={!prompt.trim()} aria-label="发送消息"><Send size={15} /></button>
              )}
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
                <Viewport3D
                  world={world}
                  xray={xray}
                  redstoneOnly={redstoneOnly}
                  layer={layer}
                  selected={selected}
                  versionPack={pack}
                  resourcePacks={resourcePacks}
                  onSelect={setSelected}
                />
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
