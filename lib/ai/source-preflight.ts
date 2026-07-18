import { parse, type Node } from "acorn";

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

type AstNode = Node & Record<string, unknown>;

const FORBIDDEN_IDENTIFIERS = new Map([
  ["fetch", "fetch"],
  ["XMLHttpRequest", "网络 API"],
  ["WebSocket", "网络 API"],
  ["EventSource", "网络 API"],
  ["Worker", "Worker API"],
  ["SharedWorker", "Worker API"],
  ["document", "浏览器全局对象"],
  ["window", "浏览器全局对象"],
  ["globalThis", "全局对象"],
  ["self", "全局对象"],
  ["navigator", "浏览器全局对象"],
  ["location", "浏览器全局对象"],
  ["localStorage", "浏览器存储"],
  ["sessionStorage", "浏览器存储"],
  ["indexedDB", "浏览器存储"],
  ["caches", "浏览器存储"],
  ["process", "宿主运行时对象"],
  ["Deno", "宿主运行时对象"],
  ["Bun", "宿主运行时对象"],
  ["eval", "动态代码执行"],
  ["Function", "动态代码执行"],
  ["require", "模块加载"],
  ["importScripts", "模块加载"],
  ["setTimeout", "异步调度 API"],
  ["setInterval", "异步调度 API"],
  ["queueMicrotask", "异步调度 API"],
  ["__collectBuild", "沙箱内部收集器"],
]);

const REGION_OPERATIONS = new Set([
  "set",
  "fill",
  "hollowBox",
  "walls",
  "line",
  "pillar",
  "replace",
]);

function isNode(value: unknown): value is AstNode {
  return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string");
}

function walk(node: AstNode, visit: (node: AstNode) => void) {
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    if (node.type === "MemberExpression" && key === "property" && node.computed !== true) continue;
    if ((node.type === "Property" || node.type === "MethodDefinition") && key === "key" && node.computed !== true) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visit);
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

function propertyName(node: AstNode | undefined): string | null {
  if (!node || node.type !== "MemberExpression") return null;
  const property = node.property;
  if (!isNode(property)) return null;
  if (node.computed !== true && property.type === "Identifier") return String(property.name);
  if (node.computed === true && property.type === "Literal" && typeof property.value === "string") {
    return property.value;
  }
  return null;
}

function literalString(node: unknown): string | null {
  return isNode(node) && node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : null;
}

function callArguments(node: AstNode): AstNode[] {
  return Array.isArray(node.arguments) ? node.arguments.filter(isNode) : [];
}

function isMemberCall(node: AstNode, objectName: string, methodName: string) {
  if (node.type !== "CallExpression" || !isNode(node.callee) || node.callee.type !== "MemberExpression") {
    return false;
  }
  const object = node.callee.object;
  return isNode(object)
    && object.type === "Identifier"
    && object.name === objectName
    && propertyName(node.callee) === methodName;
}

function isRegionFactoryCall(node: AstNode) {
  return node.type === "CallExpression"
    && isNode(node.callee)
    && node.callee.type === "MemberExpression"
    && propertyName(node.callee) === "region";
}

function namespaceError(blockId: string) {
  if (!/^[a-z0-9_./-]+$/i.test(blockId) || blockId.includes(":")) return null;
  return `方块 ID ${blockId} 缺少命名空间；请使用 minecraft:${blockId}`;
}

export function preflightBuilderSource(
  source: string,
  targetVersion: string,
  maxBuildBlocks: number,
): SourcePreflightResult {
  if (!source.trim()) {
    return { accepted: false, stage: "structure", error: "提交的源码为空" };
  }

  let program: AstNode;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
    }) as unknown as AstNode;
  } catch (error) {
    const syntax = error as Error & { loc?: { line: number; column: number } };
    const location = syntax.loc ? `第 ${syntax.loc.line} 行第 ${syntax.loc.column + 1} 列：` : "";
    return { accepted: false, stage: "syntax", error: `${location}${syntax.message}` };
  }

  let securityError = "";
  let buildCall: AstNode | null = null;
  let regionCount = 0;
  let operationCount = 0;
  const regionVariables = new Set<string>();
  const blockIdCandidates: string[] = [];

  walk(program, (node) => {
    if (securityError) return;

    if (
      node.type === "ImportDeclaration"
      || node.type === "ImportExpression"
      || node.type === "ExportNamedDeclaration"
      || node.type === "ExportDefaultDeclaration"
      || node.type === "ExportAllDeclaration"
    ) {
      securityError = "受控 Building SDK 不允许模块导入或导出";
      return;
    }
    if (node.type === "AwaitExpression") {
      securityError = "受控 Building SDK 不允许异步等待";
      return;
    }
    if (node.type === "Identifier") {
      const label = FORBIDDEN_IDENTIFIERS.get(String(node.name));
      if (label) {
        securityError = `受控 Building SDK 不允许使用 ${label}`;
        return;
      }
    }
    if (
      (node.type === "WhileStatement"
        && isNode(node.test)
        && node.test.type === "Literal"
        && (node.test.value === true || node.test.value === 1))
      || (node.type === "ForStatement" && node.test == null)
    ) {
      securityError = "源码包含明显不会结束的循环";
      return;
    }

    if (isMemberCall(node, "mc", "build")) buildCall ??= node;

    if (isRegionFactoryCall(node)) regionCount += 1;
    if (
      node.type === "VariableDeclarator"
      && isNode(node.id)
      && node.id.type === "Identifier"
      && isNode(node.init)
      && isRegionFactoryCall(node.init)
    ) {
      regionVariables.add(String(node.id.name));
    }

    if (node.type !== "CallExpression" || !isNode(node.callee)) return;
    if (node.callee.type === "Identifier" && node.callee.name === "block") {
      const blockId = literalString(callArguments(node)[0]);
      if (blockId) blockIdCandidates.push(blockId);
      return;
    }
    if (node.callee.type !== "MemberExpression") return;
    const method = propertyName(node.callee);
    if (!method || !REGION_OPERATIONS.has(method)) return;
    const receiver = node.callee.object;
    const isKnownRegion = (
      isNode(receiver)
      && ((receiver.type === "Identifier" && regionVariables.has(String(receiver.name))) || isRegionFactoryCall(receiver))
    );
    if (!isKnownRegion) return;

    operationCount += 1;
    const args = callArguments(node);
    const possibleBlockArgs = method === "replace" ? args.slice(-2) : args.slice(-1);
    for (const argument of possibleBlockArgs) {
      const blockId = literalString(argument);
      if (blockId) blockIdCandidates.push(blockId);
    }
  });

  if (securityError) return { accepted: false, stage: "security", error: securityError };
  if (!buildCall) {
    return { accepted: false, stage: "structure", error: "源码必须调用 mc.build(...) 提交建筑" };
  }

  const metadata = callArguments(buildCall)[0];
  if (!metadata || metadata.type !== "ObjectExpression" || !Array.isArray(metadata.properties)) {
    return {
      accepted: false,
      stage: "metadata",
      error: `mc.build 元数据必须显式声明 version: "${targetVersion}"`,
    };
  }
  let declaredVersion: string | null = null;
  for (const property of metadata.properties.filter(isNode)) {
    if (property.type !== "Property" || !isNode(property.key)) continue;
    const key = property.key.type === "Identifier" ? property.key.name : literalString(property.key);
    if (key !== "version") continue;
    declaredVersion = literalString(property.value);
  }
  if (!declaredVersion) {
    return {
      accepted: false,
      stage: "metadata",
      error: `mc.build 元数据必须显式声明 version: "${targetVersion}"`,
    };
  }
  if (declaredVersion !== targetVersion) {
    return {
      accepted: false,
      stage: "metadata",
      error: `mc.build 中的版本是 ${declaredVersion}，必须改为 ${targetVersion}`,
    };
  }

  for (const blockId of blockIdCandidates) {
    const error = namespaceError(blockId);
    if (error) return { accepted: false, stage: "structure", error };
  }

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
