import type { BuilderUIMessage } from "@/lib/ai/agent-protocol";

const DATABASE_NAME = "forgescript-agent";
const DATABASE_VERSION = 1;
const STORE_NAME = "sessions";
const SESSION_ID = "active";

export type PersistedAgentSession = {
  id: typeof SESSION_ID;
  messages: BuilderUIMessage[];
  source: string;
  version: string;
  sourceSnapshots: Record<string, { source: string; version: string }>;
  updatedAt: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("无法打开 Agent 本地数据库"));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error("Agent 本地数据库操作失败"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Agent 本地数据库事务已中止"));
      transaction.oncomplete = () => resolve(result);
    });
  } finally {
    database.close();
  }
}

export async function loadAgentSession(): Promise<PersistedAgentSession | null> {
  if (typeof indexedDB === "undefined") return null;
  const session = await withStore<PersistedAgentSession | undefined>(
    "readonly",
    (store) => store.get(SESSION_ID),
  );
  if (!session || !Array.isArray(session.messages) || typeof session.source !== "string") return null;
  const sourceSnapshots = Object.fromEntries(
    Object.entries(session.sourceSnapshots ?? {}).filter((entry): entry is [string, { source: string; version: string }] => (
      Boolean(
        entry[1]
        && typeof entry[1] === "object"
        && typeof (entry[1] as { source?: unknown }).source === "string"
        && typeof (entry[1] as { version?: unknown }).version === "string",
      )
    )),
  );
  return {
    ...session,
    version: typeof session.version === "string" ? session.version : "1.21.11",
    sourceSnapshots,
  };
}

export async function saveAgentSession(
  session: Omit<PersistedAgentSession, "id" | "updatedAt">,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await withStore<IDBValidKey>("readwrite", (store) => store.put({
    id: SESSION_ID,
    ...session,
    updatedAt: Date.now(),
  } satisfies PersistedAgentSession));
}

export async function clearAgentSession(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await withStore<undefined>("readwrite", (store) => store.delete(SESSION_ID));
}
