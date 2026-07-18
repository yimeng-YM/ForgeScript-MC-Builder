const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const cwd = __dirname;

// Step 1: Generate app/page.tsx
const pageContent = `"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const BuilderWorkbench = dynamic(
  () => import("@/components/builder/workbench").then((m) => m.BuilderWorkbench),
  {
    ssr: false,
    loading: () => (
      <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0a0a0f",color:"#888",fontFamily:"system-ui, sans-serif"}}>
        <div style={{textAlign:"center"}}>
          <div style={{width:40,height:40,border:"3px solid #333",borderTopColor:"#6366f1",borderRadius:"50%",margin:"0 auto 16px",animation:"spin 1s linear infinite"}} />
          <div>LLM MC Builder</div>
          <style>{\x60@keyframes spin { to { transform: rotate(360deg); } }\x60}</style>
        </div>
      </div>
    ),
  }
);

export default function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div style={{minHeight:"100vh",background:"#0a0a0f"}} />;
  return <BuilderWorkbench />;
}
`;
fs.writeFileSync(path.join(cwd, "app", "page.tsx"), pageContent, "utf8");
console.log("Page generated");

// Step 2: Build. npm run build owns the canonical SSR module repair.
console.log("Building...");
cp.execSync("npm install", { cwd, stdio: "inherit" });
cp.execSync("npm run build", { cwd, stdio: "inherit" });
