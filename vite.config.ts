import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  // 在生产打包 (build) 时将 ssr 子环境设为空，以彻底减少服务端体积防止超出 Cloudflare Workers 免费版 3MB 限制。
  // 在本地开发 (serve) 时保留 ssr 子环境，以使 Vite dev 环境的 Module runner 能够正常跑起。
  const childEnvironments = command === "build" ? [] : ["ssr"];

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    ssr: {
      external: ["class-variance-authority", "clsx", "tailwind-merge"],
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments },
        config: localBindingConfig,
      }),
    ],
  };
});
