"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Dialog } from "radix-ui";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Check,
  CircleAlert,
  FileArchive,
  FolderUp,
  Layers3,
  LoaderCircle,
  PackageOpen,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteResourcePack,
  importResourcePack,
  resourcePackCompatibility,
  type ResourcePackSummary,
} from "@/lib/minecraft/resource-packs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packs: ResourcePackSummary[];
  gameVersion: string;
  targetFormat: number | null;
  onApply: (packs: ResourcePackSummary[]) => Promise<void>;
};

function normalizeOrder(packs: ResourcePackSummary[]) {
  return packs.map((pack, order) => ({ ...pack, order }));
}

function displaySize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function compatibilityLabel(pack: ResourcePackSummary, targetFormat: number | null) {
  const compatibility = resourcePackCompatibility(pack, targetFormat);
  if (compatibility === "compatible") return { className: "compatible", text: "兼容" };
  if (compatibility === "newer") return { className: "incompatible", text: "版本过新" };
  if (compatibility === "older") return { className: "incompatible", text: "版本过旧" };
  return { className: "unknown", text: pack.kind === "client-jar" ? "原版基础层" : "格式未知" };
}

function PackIcon({ pack }: { pack: ResourcePackSummary }) {
  if (pack.iconDataUrl) return <Image src={pack.iconDataUrl} alt="" width={48} height={48} unoptimized />;
  return pack.kind === "client-jar" ? <Box aria-hidden="true" /> : <FileArchive aria-hidden="true" />;
}

function PackDetails({ pack, targetFormat }: { pack: ResourcePackSummary; targetFormat: number | null }) {
  const compatibility = compatibilityLabel(pack, targetFormat);
  return (
    <div className="resource-pack-copy">
      <div className="resource-pack-name-row">
        <strong>{pack.name}</strong>
        <span className={`pack-compatibility ${compatibility.className}`}>{compatibility.text}</span>
      </div>
      <p>{pack.description}</p>
      <small>
        {displaySize(pack.fileSize)} · {pack.assetCount.toLocaleString()} 项资源
        {pack.packFormat !== null ? ` · 格式 ${pack.packFormat}` : ""}
        {pack.overlayCount > 0 ? ` · ${pack.overlayCount} 个 overlay` : ""}
      </small>
    </div>
  );
}

export function ResourcePackDialog({
  open,
  onOpenChange,
  packs,
  gameVersion,
  targetFormat,
  onApply,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<ResourcePackSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("列表顶部的资源包具有最高优先级。");
  const [messageKind, setMessageKind] = useState<"info" | "success" | "error">("info");

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const sorted = [...packs].sort((left, right) => left.order - right.order);
      setDrafts(normalizeOrder([
        ...sorted.filter((pack) => pack.enabled),
        ...sorted.filter((pack) => !pack.enabled),
      ]));
      setMessage("列表顶部的资源包具有最高优先级。扩展包应放在其基础包上方。");
      setMessageKind("info");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, packs]);

  const enabled = useMemo(() => drafts.filter((pack) => pack.enabled), [drafts]);
  const available = useMemo(() => drafts.filter((pack) => !pack.enabled), [drafts]);

  const setEnabled = (id: string, nextEnabled: boolean) => {
    setDrafts((current) => {
      const target = current.find((pack) => pack.id === id);
      if (!target) return current;
      const remainingEnabled = current.filter((pack) => pack.enabled && pack.id !== id);
      const remainingAvailable = current.filter((pack) => !pack.enabled && pack.id !== id);
      return normalizeOrder(nextEnabled
        ? [{ ...target, enabled: true }, ...remainingEnabled, ...remainingAvailable]
        : [...remainingEnabled, { ...target, enabled: false }, ...remainingAvailable]);
    });
  };

  const moveEnabled = (id: string, delta: -1 | 1) => {
    setDrafts((current) => {
      const active = current.filter((pack) => pack.enabled);
      const index = active.findIndex((pack) => pack.id === id);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= active.length) return current;
      [active[index], active[nextIndex]] = [active[nextIndex], active[index]];
      return normalizeOrder([...active, ...current.filter((pack) => !pack.enabled)]);
    });
  };

  const importFiles = async (fileList: FileList | File[]) => {
    const files = [...fileList].filter((file) => /\.(zip|jar)$/i.test(file.name));
    if (files.length === 0) {
      setMessageKind("error");
      setMessage("请选择 Minecraft 资源包 ZIP 或客户端 JAR 文件。");
      return;
    }
    setBusy(true);
    let current = drafts;
    try {
      for (const [index, file] of files.entries()) {
        setMessageKind("info");
        setMessage(`正在解析 ${file.name}（${index + 1}/${files.length}）…`);
        const imported = await importResourcePack(file);
        current = normalizeOrder([...current, imported]);
        setDrafts(current);
      }
      await onApply(current);
      setMessageKind("success");
      setMessage(`已导入 ${files.length} 个文件；在右侧点击箭头即可启用。`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removePack = async (pack: ResourcePackSummary) => {
    if (!window.confirm(`从本机资源包库中删除“${pack.name}”？原 ZIP/JAR 不会被删除。`)) return;
    setBusy(true);
    try {
      await deleteResourcePack(pack.id);
      const next = normalizeOrder(drafts.filter((item) => item.id !== pack.id));
      setDrafts(next);
      await onApply(next);
      setMessageKind("success");
      setMessage(`已从 ForgeScript 本地库移除 ${pack.name}。`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const next = normalizeOrder(drafts);
      await onApply(next);
      setMessageKind("success");
      setMessage(`已应用 ${next.filter((pack) => pack.enabled).length} 个资源包。`);
      onOpenChange(false);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="settings-overlay" />
        <Dialog.Content className="resource-pack-dialog" aria-describedby="resource-pack-description">
          <header className="settings-header resource-pack-header">
            <div className="settings-title-icon"><PackageOpen size={19} /></div>
            <div>
              <Dialog.Title>资源包</Dialog.Title>
              <Dialog.Description id="resource-pack-description">
                Minecraft Java {gameVersion} · 多资源包叠加与原版优先级语义
              </Dialog.Description>
            </div>
            <Dialog.Close className="settings-close" aria-label="关闭资源包管理器"><X size={17} /></Dialog.Close>
          </header>

          <div className="resource-pack-body">
            <div
              className={`resource-pack-import ${dragging ? "dragging" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void importFiles(event.dataTransfer.files);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".zip,.jar,application/zip,application/java-archive"
                multiple
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => event.target.files && void importFiles(event.target.files)}
              />
              <div><FolderUp size={18} /><span><strong>导入资源包或原版客户端 JAR</strong><small>可一次选择基础包与多个扩展包，也可拖放到这里</small></span></div>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
                {busy ? <LoaderCircle size={14} className="spin" /> : <FileArchive size={14} />}选择文件
              </button>
            </div>

            <div className="resource-pack-columns">
              <section className="resource-pack-column" aria-labelledby="enabled-packs-title">
                <div className="resource-pack-column-heading">
                  <div><Layers3 size={15} /><span><strong id="enabled-packs-title">已启用</strong><small>顶部优先</small></span></div>
                  <span>{enabled.length}</span>
                </div>
                <div className="resource-pack-list selected-list">
                  {enabled.length === 0 && (
                    <div className="resource-pack-empty"><PackageOpen size={24} /><strong>使用程序化预览</strong><span>启用资源包后会加载真实 blockstate、模型与纹理。</span></div>
                  )}
                  {enabled.map((pack, index) => (
                    <article className="resource-pack-card" key={pack.id}>
                      <div className="resource-pack-priority">{index === 0 ? "最高" : index + 1}</div>
                      <div className="resource-pack-icon"><PackIcon pack={pack} /></div>
                      <PackDetails pack={pack} targetFormat={targetFormat} />
                      <div className="resource-pack-card-actions">
                        <button type="button" onClick={() => moveEnabled(pack.id, -1)} disabled={index === 0 || busy} aria-label={`提高 ${pack.name} 的优先级`}><ArrowUp size={13} /></button>
                        <button type="button" onClick={() => moveEnabled(pack.id, 1)} disabled={index === enabled.length - 1 || busy} aria-label={`降低 ${pack.name} 的优先级`}><ArrowDown size={13} /></button>
                        <button type="button" onClick={() => setEnabled(pack.id, false)} disabled={busy} aria-label={`停用 ${pack.name}`}><ArrowRight size={13} /></button>
                        <button type="button" className="danger" onClick={() => void removePack(pack)} disabled={busy} aria-label={`删除 ${pack.name}`}><Trash2 size={13} /></button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="resource-pack-column" aria-labelledby="available-packs-title">
                <div className="resource-pack-column-heading">
                  <div><FileArchive size={15} /><span><strong id="available-packs-title">可用</strong><small>本地资源库</small></span></div>
                  <span>{available.length}</span>
                </div>
                <div className="resource-pack-list">
                  {available.length === 0 && (
                    <div className="resource-pack-empty"><FolderUp size={24} /><strong>还没有可用资源包</strong><span>导入 ZIP；要获得完整原版材质，请导入对应版本客户端 JAR 作为最底层。</span></div>
                  )}
                  {available.map((pack) => (
                    <article className="resource-pack-card" key={pack.id}>
                      <div className="resource-pack-icon"><PackIcon pack={pack} /></div>
                      <PackDetails pack={pack} targetFormat={targetFormat} />
                      <div className="resource-pack-card-actions">
                        <button type="button" onClick={() => setEnabled(pack.id, true)} disabled={busy} aria-label={`启用 ${pack.name}`}><ArrowLeft size={13} /></button>
                        <button type="button" className="danger" onClick={() => void removePack(pack)} disabled={busy} aria-label={`删除 ${pack.name}`}><Trash2 size={13} /></button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <footer className="settings-footer resource-pack-footer">
            <div className={`resource-pack-message ${messageKind}`} aria-live="polite">
              {messageKind === "error" ? <CircleAlert size={14} /> : messageKind === "success" ? <Check size={14} /> : <Layers3 size={14} />}
              <span>{message}</span>
            </div>
            <div className="settings-footer-actions">
              <Dialog.Close className="test-model-button" disabled={busy}>取消</Dialog.Close>
              <button type="button" className="save-settings-button" onClick={() => void apply()} disabled={busy}>
                {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}完成
              </button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
