const fs = require("fs");
const path = require("path");
const content = `"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const BuilderWorkbench = dynamic(
  () => import("@/components/builder/workbench").then((m) => m.BuilderWorkbench),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0f",
          color: "#888",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: "3px solid #333",
              borderTopColor: "#6366f1",
              borderRadius: "50%",
              margin: "0 auto 16px",
              animation: "spin 1s linear infinite",
            }}
          />
          <div>正在加载 LLM MC Builder…</div>
          <style>{\`@keyframes spin { to { transform: rotate(360deg); } }\`}</style>
        </div>
      </div>
    ),
  }
);

export default function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0a0a0f",
        }}
      />
    );
  }

  return <BuilderWorkbench />;
`;
const target = path.join(__dirname, "app", "page.tsx");
fs.writeFileSync(target, content, "utf8");
console.log("written", fs.readFileSync(target, "utf8").length, "bytes");
