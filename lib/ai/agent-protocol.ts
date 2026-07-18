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
export type BuilderMessageMetadata = { isAutoFix?: boolean };
export type BuilderTools = {
  commit_source: {
    input: CommitSourceInput;
    output: CommitSourceOutput;
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
