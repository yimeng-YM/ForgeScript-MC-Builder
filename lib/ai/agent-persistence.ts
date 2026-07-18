const DATABASE_NAME = "forgescript-agent";

export async function clearAgentSession(): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("无法删除旧的 Agent 本地数据库"));
    request.onblocked = () => reject(new Error("旧的 Agent 本地数据库仍被其他页面占用"));
  });
}
