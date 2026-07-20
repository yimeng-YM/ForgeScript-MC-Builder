import type { UIMessage } from "ai";
import { z } from "zod";

export const commitSourceInputSchema = z.object({
  source: z.string().max(80_000),
  summary: z.string().max(500),
  version: z.string().min(1).max(40),
});

export const commitSourceOutputSchema = z.object({
  accepted: z.boolean(),
  stage: z.enum(["syntax", "security", "metadata", "structure", "runtime", "registry", "cancelled"]).optional(),
  error: z.string().max(20_000).optional(),
  summary: z.string().max(500).optional(),
  sourceLength: z.number().int().nonnegative().optional(),
  terminal: z.boolean().optional(),
  exhausted: z.boolean().optional(),
  attempt: z.number().int().positive().optional(),
  maxAttempts: z.number().int().positive().optional(),
  validation: z.object({
    declaredVersion: z.string().optional(),
    regionCount: z.number().int().nonnegative().optional(),
    operationCount: z.number().int().nonnegative().optional(),
    maxBuildBlocks: z.number().int().positive().optional(),
    blockCount: z.number().int().nonnegative().optional(),
    paletteSize: z.number().int().nonnegative().optional(),
    size: z.array(z.number()).length(3).optional(),
  }).passthrough().optional(),
}).passthrough();

export type CommitSourceInput = z.infer<typeof commitSourceInputSchema>;
export type CommitSourceOutput = z.infer<typeof commitSourceOutputSchema>;

// read_source - 读取当前源码
export const readSourceInputSchema = z.object({
  lineStart: z.number().int().positive().optional().describe("起始行号（可选，默认从第1行开始）"),
  lineEnd: z.number().int().positive().optional().describe("结束行号（可选，默认读取到末尾）"),
}).passthrough();

export const readSourceOutputSchema = z.object({
  source: z.string().describe("当前源码内容"),
  totalLines: z.number().int().nonnegative().describe("总行数"),
  returnedLines: z.number().int().nonnegative().describe("返回的行数"),
  lineStart: z.number().int().positive().describe("实际起始行号"),
  lineEnd: z.number().int().positive().describe("实际结束行号"),
}).passthrough();

// search_source - 搜索源码内容
export const searchSourceInputSchema = z.object({
  query: z.string().min(1).max(200).describe("搜索关键词或正则表达式"),
  isRegex: z.boolean().default(false).describe("是否使用正则表达式搜索"),
  contextLines: z.number().int().min(0).max(10).default(2).describe("显示匹配行前后的上下文行数"),
}).passthrough();

export const searchSourceOutputSchema = z.object({
  matches: z.array(z.object({
    lineNumber: z.number().int().positive().describe("匹配行号"),
    line: z.string().describe("匹配的行内容"),
    context: z.array(z.string()).optional().describe("上下文行"),
  })).describe("匹配结果列表"),
  totalMatches: z.number().int().nonnegative().describe("总匹配数"),
  query: z.string().describe("搜索的查询"),
}).passthrough();

// edit_source - 增量编辑源码
export const editSourceInputSchema = z.object({
  operations: z.array(z.object({
    type: z.enum(["insert", "replace", "delete"]).describe("操作类型"),
    lineStart: z.number().int().positive().describe("起始行号"),
    lineEnd: z.number().int().positive().optional().describe("结束行号（replace和delete时必填）"),
    content: z.string().max(50_000).optional().describe("插入或替换的内容（insert和replace时必填）"),
  })).min(1).max(20).describe("编辑操作列表"),
  summary: z.string().max(500).describe("本次编辑的摘要说明"),
}).passthrough();

export const editSourceOutputSchema = z.object({
  accepted: z.boolean().describe("编辑是否被接受"),
  error: z.string().max(20_000).optional().describe("错误信息"),
  newSource: z.string().optional().describe("编辑后的完整源码"),
  operationsApplied: z.number().int().nonnegative().describe("成功应用的操作数"),
  totalOperations: z.number().int().nonnegative().describe("总操作数"),
}).passthrough();

export type ReadSourceInput = z.infer<typeof readSourceInputSchema>;
export type ReadSourceOutput = z.infer<typeof readSourceOutputSchema>;
export type SearchSourceInput = z.infer<typeof searchSourceInputSchema>;
export type SearchSourceOutput = z.infer<typeof searchSourceOutputSchema>;
export type EditSourceInput = z.infer<typeof editSourceInputSchema>;
export type EditSourceOutput = z.infer<typeof editSourceOutputSchema>;

export type BuilderMessageMetadata = { isAutoFix?: boolean };
export type BuilderTools = {
  commit_source: {
    input: CommitSourceInput;
    output: CommitSourceOutput;
  };
  read_source: {
    input: ReadSourceInput;
    output: ReadSourceOutput;
  };
  search_source: {
    input: SearchSourceInput;
    output: SearchSourceOutput;
  };
  edit_source: {
    input: EditSourceInput;
    output: EditSourceOutput;
  };
};
export type BuilderUIMessage = UIMessage<BuilderMessageMetadata, never, BuilderTools>;

export function latestCommitOutput(messages: UIMessage[]): CommitSourceOutput | null {
  const message = messages.at(-1);
  if (!message || message.role !== "assistant") return null;
  for (const part of [...message.parts].reverse()) {
    if (part.type !== "tool-commit_source" || !("output" in part)) continue;
    const parsed = commitSourceOutputSchema.safeParse(part.output);
    if (parsed.success) return parsed.data;
  }
  return null;
}

export function commitInputSource(message: UIMessage): string | null {
  for (const part of message.parts) {
    if (part.type !== "tool-commit_source" || !("input" in part)) continue;
    const parsed = commitSourceInputSchema.safeParse(part.input);
    if (parsed.success) return parsed.data.source;
  }
  return null;
}
