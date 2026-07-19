"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribeToClientMount = () => () => {};

export function ClientOnly({ children, fallback }: { children: () => ReactNode; fallback?: ReactNode }) {
  const mounted = useSyncExternalStore(subscribeToClientMount, () => true, () => false);
  if (!mounted) return <>{fallback ?? null}</>;
  return <>{children()}</>;
}
