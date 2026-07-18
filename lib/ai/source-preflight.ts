export type SourcePreflightResult =
  | {
      accepted: true;
      sourceLength: number;
      validation: {
        declaredVersion: string;
        regionCount: number;
        operationCount: number;
        maxBuildBlocks: number;
      };
    }
  | {
      accepted: false;
      stage: "syntax" | "security" | "metadata" | "structure";
      error: string;
    };

type ScanResult = {
  codeOnly: string;
  withoutComments: string;
  error?: string;
};

const PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
};

/**
 * Produces a code-only view for structural checks without evaluating user code.
 * The comment-free view keeps string literals so metadata and block IDs can be read.
 */
function scanSource(source: string): ScanResult {
  let codeOnly = "";
  let withoutComments = "";
  let state: "code" | "line-comment" | "block-comment" | "single" | "double" | "template" = "code";
  let escaped = false;
  const stack: Array<{ token: string; index: number }> = [];

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      const replacement = char === "\n" ? "\n" : " ";
      codeOnly += replacement;
      withoutComments += replacement;
      if (char === "\n") state = "code";
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        codeOnly += "  ";
        withoutComments += "  ";
        index += 1;
        state = "code";
      } else {
        const replacement = char === "\n" ? "\n" : " ";
        codeOnly += replacement;
        withoutComments += replacement;
      }
      continue;
    }

    if (state !== "code") {
      codeOnly += char === "\n" ? "\n" : " ";
      withoutComments += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      codeOnly += "  ";
      withoutComments += "  ";
      index += 1;
      state = "line-comment";
      continue;
    }
    if (char === "/" && next === "*") {
      codeOnly += "  ";
      withoutComments += "  ";
      index += 1;
      state = "block-comment";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      codeOnly += " ";
      withoutComments += char;
      state = char === "'" ? "single" : char === '"' ? "double" : "template";
      continue;
    }

    if (char in PAIRS) {
      stack.push({ token: char, index });
    } else if (char === ")" || char === "]" || char === "}") {
      const opening = stack.pop();
      if (!opening || PAIRS[opening.token] !== char) {
        return { codeOnly, withoutComments, error: `第 ${index + 1} 个字符附近存在不匹配的 ${char}` };
      }
    }

    codeOnly += char;
    withoutComments += char;
  }

  if (state === "block-comment") {
    return { codeOnly, withoutComments, error: "源码中存在未结束的块注释" };
  }
  if (state === "single" || state === "double" || state === "template") {
    return { codeOnly, withoutComments, error: "源码中存在未结束的字符串" };
  }
  const opening = stack.at(-1);
  if (opening) {
    return {
      codeOnly,
      withoutComments,
      error: `第 ${opening.index + 1} 个字符附近的 ${opening.token} 没有闭合`,
    };
  }
  return { codeOnly, withoutComments };
}

const FORBIDDEN_CODE: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfetch\s*\(/, label: "fetch" },
  { pattern: /\b(?:XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker)\b/, label: "网络或 Worker API" },
  { pattern: /\b(?:document|window|navigator|location|localStorage|sessionStorage|indexedDB|caches)\b/, label: "浏览器全局对象" },
  { pattern: /\b(?:process|Deno|Bun)\b/, label: "宿主运行时对象" },
  { pattern: /\b(?:eval|Function|require|importScripts)\s*\(/, label: "动态代码或模块加载" },
  { pattern: /\bimport\b/, label: "模块导入" },
  { pattern: /\b(?:setTimeout|setInterval|queueMicrotask)\s*\(/, label: "计时或异步调度 API" },
];

export function preflightBuilderSource(
  source: string,
  targetVersion: string,
  maxBuildBlocks: number,
): SourcePreflightResult {
  if (!source.trim()) {
    return { accepted: false, stage: "structure", error: "提交的源码为空" };
  }

  const scanned = scanSource(source);
  if (scanned.error) {
    return { accepted: false, stage: "syntax", error: scanned.error };
  }

  if (!/\bmc\s*\.\s*build\s*\(/.test(scanned.codeOnly)) {
    return { accepted: false, stage: "structure", error: "源码必须调用 mc.build(...) 提交建筑" };
  }

  for (const rule of FORBIDDEN_CODE) {
    if (rule.pattern.test(scanned.codeOnly)) {
      return {
        accepted: false,
        stage: "security",
        error: `受控 Building SDK 不允许使用 ${rule.label}`,
      };
    }
  }

  if (/\bwhile\s*\(\s*(?:true|1)\s*\)|\bfor\s*\(\s*;\s*;\s*\)/.test(scanned.codeOnly)) {
    return { accepted: false, stage: "security", error: "源码包含明显不会结束的循环" };
  }

  const versionMatch = scanned.withoutComments.match(/\bversion\s*:\s*(["'])([^"']+)\1/);
  if (!versionMatch) {
    return {
      accepted: false,
      stage: "metadata",
      error: `mc.build 元数据必须显式声明 version: "${targetVersion}"`,
    };
  }
  const declaredVersion = versionMatch[2];
  if (declaredVersion !== targetVersion) {
    return {
      accepted: false,
      stage: "metadata",
      error: `mc.build 中的版本是 ${declaredVersion}，必须改为 ${targetVersion}`,
    };
  }

  for (const match of scanned.withoutComments.matchAll(/\bblock\s*\(\s*(["'])([^"']+)\1/g)) {
    const blockId = match[2];
    if (/^[a-z0-9_./-]+$/i.test(blockId) && !blockId.includes(":")) {
      return {
        accepted: false,
        stage: "structure",
        error: `方块 ID ${blockId} 缺少命名空间；请使用 minecraft:${blockId}`,
      };
    }
  }

  const regionCount = (scanned.codeOnly.match(/\.\s*region\s*\(/g) ?? []).length;
  const operationCount = (
    scanned.codeOnly.match(/\.\s*(?:set|fill|hollowBox|walls|line|pillar|replace)\s*\(/g) ?? []
  ).length;

  return {
    accepted: true,
    sourceLength: source.length,
    validation: {
      declaredVersion,
      regionCount,
      operationCount,
      maxBuildBlocks,
    },
  };
}
