import { strFromU8, unzip } from "fflate";

const DATABASE_NAME = "forgescript-resource-packs";
const DATABASE_VERSION = 1;
const STORE_NAME = "packs";
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 40_000;
const MAX_ICON_BYTES = 2 * 1024 * 1024;

export type ResourcePackKind = "resource-pack" | "client-jar";

export type ResourcePackSummary = {
  id: string;
  name: string;
  description: string;
  fileName: string;
  fileSize: number;
  kind: ResourcePackKind;
  packFormat: number | null;
  minFormat: number | null;
  maxFormat: number | null;
  enabled: boolean;
  order: number;
  importedAt: number;
  assetCount: number;
  overlayCount: number;
  iconDataUrl: string | null;
  warnings: string[];
};

type FormatRange = { min: number; max: number };

type PackOverlay = {
  directory: string;
  formats: FormatRange;
};

type PackFilter = {
  namespace?: string;
  path?: string;
};

type ResourcePackRecord = ResourcePackSummary & {
  blob: Blob;
  archiveRoot: string;
  overlays: PackOverlay[];
  filters: PackFilter[];
};

export type ResolvedResourceAssets = {
  files: Map<string, Uint8Array>;
  enabledPacks: ResourcePackSummary[];
  warnings: string[];
};

type ParsedMetadata = {
  name: string;
  description: string;
  packFormat: number | null;
  minFormat: number | null;
  maxFormat: number | null;
  overlays: PackOverlay[];
  filters: PackFilter[];
};

type UnpackedArchive = {
  files: Map<string, Uint8Array>;
  archiveRoot: string;
};

const archiveCache = new Map<string, Promise<UnpackedArchive>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatEndpoint(value: unknown): number | null {
  const direct = asFiniteNumber(value);
  if (direct !== null) return direct;
  if (Array.isArray(value)) {
    return value.map(asFiniteNumber).find((item): item is number => item !== null) ?? null;
  }
  return null;
}

function readFormatRange(value: unknown, fallback: number | null): FormatRange | null {
  const direct = asFiniteNumber(value);
  if (direct !== null) return { min: direct, max: direct };

  if (Array.isArray(value)) {
    const values = value.map(formatEndpoint).filter((item): item is number => item !== null);
    if (values.length > 0) return { min: Math.min(...values), max: Math.max(...values) };
  }

  const record = asRecord(value);
  if (record) {
    const min = formatEndpoint(record.min_inclusive ?? record.min);
    const max = formatEndpoint(record.max_inclusive ?? record.max);
    if (min !== null || max !== null) {
      return { min: min ?? max ?? fallback ?? 0, max: max ?? min ?? fallback ?? 0 };
    }
  }

  return fallback === null ? null : { min: fallback, max: fallback };
}

function textComponentToPlain(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textComponentToPlain).join("");
  const record = asRecord(value);
  if (!record) return "";

  const base = typeof record.text === "string"
    ? record.text
    : typeof record.fallback === "string"
      ? record.fallback
      : typeof record.translate === "string"
        ? record.translate
        : "";
  const withArgs = Array.isArray(record.with)
    ? ` ${record.with.map(textComponentToPlain).filter(Boolean).join(" ")}`
    : "";
  const extra = Array.isArray(record.extra) ? record.extra.map(textComponentToPlain).join("") : "";
  return `${base}${withArgs}${extra}`;
}

function normalizeArchivePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

function cleanDirectory(path: string) {
  return normalizeArchivePath(path).replace(/^\/+|\/+$/g, "");
}

export function parseResourcePackMetadata(text: string, fallbackName: string): ParsedMetadata {
  const root = asRecord(JSON.parse(text));
  const pack = asRecord(root?.pack);
  if (!root || !pack) throw new Error("pack.mcmeta 缺少 pack 对象");

  const packFormat = asFiniteNumber(pack.pack_format);
  const range = readFormatRange(pack.supported_formats, packFormat);
  const overlaysRoot = asRecord(root.overlays);
  const overlays = (Array.isArray(overlaysRoot?.entries) ? overlaysRoot.entries : [])
    .map((entry): PackOverlay | null => {
      const item = asRecord(entry);
      const directory = typeof item?.directory === "string" ? cleanDirectory(item.directory) : "";
      const formats = readFormatRange(item?.formats, packFormat);
      return directory && formats ? { directory, formats } : null;
    })
    .filter((entry): entry is PackOverlay => entry !== null);

  const filterRoot = asRecord(root.filter);
  const filters = (Array.isArray(filterRoot?.block) ? filterRoot.block : [])
    .map((entry): PackFilter | null => {
      const item = asRecord(entry);
      if (!item) return null;
      const namespace = typeof item.namespace === "string" ? item.namespace : undefined;
      const path = typeof item.path === "string" ? item.path : undefined;
      return namespace || path ? { namespace, path } : null;
    })
    .filter((entry): entry is PackFilter => entry !== null);

  return {
    name: fallbackName,
    description: textComponentToPlain(pack.description).trim() || "未提供资源包说明",
    packFormat,
    minFormat: range?.min ?? packFormat,
    maxFormat: range?.max ?? packFormat,
    overlays,
    filters,
  };
}

export function findResourceArchiveRoot(files: Map<string, Uint8Array>) {
  const assetRoots = [...new Set([...files.keys()]
    .map((path) => {
      const match = path.match(/(^|\/)assets\/[^/]+\//i);
      if (!match || match.index === undefined) return null;
      return path.slice(0, match.index + (match[1] === "/" ? 1 : 0));
    })
    .filter((root): root is string => root !== null))]
    .sort((left, right) => left.split("/").length - right.split("/").length || left.length - right.length);

  // Client JARs do not necessarily have a root pack.mcmeta, but can contain
  // nested data-pack metadata. The assets directory is therefore the source
  // of truth; prefer an assets root paired with pack.mcmeta for normal ZIPs.
  const pairedRoot = assetRoots.find((root) => files.has(`${root}pack.mcmeta`));
  if (pairedRoot !== undefined) return pairedRoot;
  if (assetRoots.length > 0) return assetRoots[0];

  throw new Error("压缩包中没有 assets/<namespace> 资源目录");
}

function unzipBytes(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, result) => {
      if (error) {
        reject(new Error(`ZIP 解压失败：${error.message}`));
        return;
      }
      const entries = Object.entries(result);
      if (entries.length > MAX_ARCHIVE_ENTRIES) {
        reject(new Error(`资源包包含 ${entries.length.toLocaleString()} 个文件，超过 ${MAX_ARCHIVE_ENTRIES.toLocaleString()} 个的安全上限`));
        return;
      }
      const unpackedBytes = entries.reduce((total, [, value]) => total + value.byteLength, 0);
      if (unpackedBytes > MAX_UNPACKED_BYTES) {
        reject(new Error(`资源包解压后为 ${(unpackedBytes / 1024 / 1024).toFixed(1)} MB，超过 512 MB 的安全上限`));
        return;
      }
      resolve(new Map(entries.map(([path, value]) => [normalizeArchivePath(path), value])));
    });
  });
}

async function bytesToDataUrl(bytes: Uint8Array, type: string) {
  if (bytes.byteLength > MAX_ICON_BYTES) return null;
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes], { type });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("无法读取资源包图标"));
    reader.readAsDataURL(blob);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开资源包数据库"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("资源包数据库操作失败"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("资源包数据库事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("资源包数据库事务已中止"));
  });
}

function toSummary(record: ResourcePackRecord): ResourcePackSummary {
  const summary: Partial<ResourcePackRecord> = { ...record };
  delete summary.blob;
  delete summary.archiveRoot;
  delete summary.overlays;
  delete summary.filters;
  return summary as ResourcePackSummary;
}

async function putRecord(record: ResourcePackRecord) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(STORE_NAME).put(record);
  await done;
  database.close();
}

export async function listResourcePacks(): Promise<ResourcePackSummary[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const records = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as ResourcePackRecord[];
  await done;
  database.close();
  return records.map(toSummary).sort((left, right) => left.order - right.order || right.importedAt - left.importedAt);
}

export async function importResourcePack(file: File): Promise<ResourcePackSummary> {
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`资源包 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 256 MB 的当前导入上限`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = await unzipBytes(bytes);
  const archiveRoot = findResourceArchiveRoot(files);
  const metadataBytes = files.get(`${archiveRoot}pack.mcmeta`);
  const fallbackName = file.name.replace(/\.(zip|jar)$/i, "");
  const metadata = metadataBytes
    ? parseResourcePackMetadata(strFromU8(metadataBytes), fallbackName)
    : {
        name: fallbackName,
        description: "Minecraft 客户端资源（作为资源包栈的原版基础层）",
        packFormat: null,
        minFormat: null,
        maxFormat: null,
        overlays: [],
        filters: [],
      };
  const iconBytes = files.get(`${archiveRoot}pack.png`);
  const existing = await listResourcePacks();
  const importedAt = Date.now();
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pack-${importedAt}-${Math.random().toString(36).slice(2)}`;
  const assetCount = [...files.keys()].filter((path) => path.startsWith(`${archiveRoot}assets/`)).length;
  const warnings: string[] = [];
  if (!metadataBytes) warnings.push("未找到 pack.mcmeta，已按原版客户端 JAR 作为基础资源导入");
  if (assetCount === 0) warnings.push("没有发现 assets 目录中的可渲染资源");

  const record: ResourcePackRecord = {
    id,
    name: metadata.name,
    description: metadata.description,
    fileName: file.name,
    fileSize: file.size,
    kind: /\.jar$/i.test(file.name) ? "client-jar" : "resource-pack",
    packFormat: metadata.packFormat,
    minFormat: metadata.minFormat,
    maxFormat: metadata.maxFormat,
    enabled: false,
    order: existing.length,
    importedAt,
    assetCount,
    overlayCount: metadata.overlays.length,
    iconDataUrl: iconBytes ? await bytesToDataUrl(iconBytes, "image/png") : null,
    warnings,
    blob: file,
    archiveRoot,
    overlays: metadata.overlays,
    filters: metadata.filters,
  };
  await putRecord(record);
  archiveCache.set(id, Promise.resolve({ files, archiveRoot }));
  return toSummary(record);
}

export async function saveResourcePackConfiguration(packs: ResourcePackSummary[]) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const records = await requestResult(store.getAll()) as ResourcePackRecord[];
  const config = new Map(packs.map((pack, order) => [pack.id, { enabled: pack.enabled, order }]));
  for (const record of records) {
    const next = config.get(record.id);
    if (next) store.put({ ...record, ...next });
  }
  await done;
  database.close();
}

export async function deleteResourcePack(id: string) {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(STORE_NAME).delete(id);
  await done;
  database.close();
  archiveCache.delete(id);
}

async function loadRecords(ids: string[]) {
  if (typeof indexedDB === "undefined" || ids.length === 0) return [];
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(STORE_NAME);
  const records = await Promise.all(ids.map((id) => requestResult(store.get(id)) as Promise<ResourcePackRecord | undefined>));
  await done;
  database.close();
  return records.filter((record): record is ResourcePackRecord => record !== undefined);
}

async function unpackRecord(record: ResourcePackRecord) {
  const cached = archiveCache.get(record.id);
  if (cached) return cached;
  const loading = record.blob.arrayBuffer()
    .then((buffer) => unzipBytes(new Uint8Array(buffer)))
    // Re-detect the root instead of trusting stored metadata so JARs imported
    // by older builds recover automatically without requiring a re-import.
    .then((files) => ({ files, archiveRoot: findResourceArchiveRoot(files) }));
  archiveCache.set(record.id, loading);
  return loading;
}

function matchesFilter(key: string, filter: PackFilter) {
  const slash = key.indexOf("/");
  const namespace = slash >= 0 ? key.slice(0, slash) : key;
  const path = slash >= 0 ? key.slice(slash + 1) : "";
  try {
    const namespaceMatches = !filter.namespace || new RegExp(filter.namespace).test(namespace);
    const pathMatches = !filter.path || new RegExp(filter.path).test(path);
    return namespaceMatches && pathMatches;
  } catch {
    return false;
  }
}

function applyAssetsFromPrefix(target: Map<string, Uint8Array>, files: Map<string, Uint8Array>, prefix: string) {
  for (const [path, bytes] of files) {
    if (!path.startsWith(prefix) || path.endsWith("/")) continue;
    target.set(path.slice(prefix.length), bytes);
  }
}

export async function resolveResourcePackAssets(
  packs: ResourcePackSummary[],
  targetFormat: number | null,
): Promise<ResolvedResourceAssets> {
  const enabledPacks = packs.filter((pack) => pack.enabled).sort((left, right) => left.order - right.order);
  if (enabledPacks.length === 0) return { files: new Map(), enabledPacks, warnings: [] };

  const records = await loadRecords(enabledPacks.map((pack) => pack.id));
  const recordMap = new Map(records.map((record) => [record.id, record]));
  const files = new Map<string, Uint8Array>();
  const warnings: string[] = [];

  // UI order is top-to-bottom priority. Resolve bottom first so upper packs overwrite it.
  for (const summary of [...enabledPacks].reverse()) {
    const record = recordMap.get(summary.id);
    if (!record) {
      warnings.push(`${summary.name} 的本地原文件已经丢失`);
      continue;
    }
    const archive = await unpackRecord(record);
    const isClientJar = record.kind === "client-jar" || /\.jar$/i.test(record.fileName);
    for (const filter of isClientJar ? [] : record.filters) {
      for (const key of files.keys()) {
        if (matchesFilter(key, filter)) files.delete(key);
      }
    }
    applyAssetsFromPrefix(files, archive.files, `${archive.archiveRoot}assets/`);
    for (const overlay of isClientJar ? [] : record.overlays) {
      const applies = targetFormat === null || (targetFormat >= overlay.formats.min && targetFormat <= overlay.formats.max);
      if (applies) {
        applyAssetsFromPrefix(files, archive.files, `${archive.archiveRoot}${overlay.directory}/assets/`);
      }
    }
  }

  return { files, enabledPacks, warnings };
}

export function resourcePackCompatibility(pack: ResourcePackSummary, targetFormat: number | null) {
  if (targetFormat === null || pack.minFormat === null || pack.maxFormat === null) return "unknown" as const;
  if (targetFormat < pack.minFormat) return "newer" as const;
  if (targetFormat > pack.maxFormat) return "older" as const;
  return "compatible" as const;
}
