export interface UsageDelta {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface ModelReceipt {
  provider: string;
  model: string;
}

export type EvidenceEvent =
  | { type: "tool_start"; name: string; args: unknown; callId: string; at: number }
  | {
      type: "tool_end";
      name: string;
      callId: string;
      outcome: "success" | "error" | "blocked" | "aborted";
      result?: unknown;
      usage?: UsageDelta;
      at: number;
    }
  | { type: "assistant_end"; text: string; usage?: UsageDelta; model?: ModelReceipt; at: number }
  | { type: "skill_activation"; skill: string; receipt: "selection" | "read"; at: number }
  | { type: "turn_end"; stopReason?: string; at: number }
  | { type: "terminal_error"; code: string; at: number };

type RawEvent = { type?: unknown; [key: string]: unknown };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readUsage(value: unknown): UsageDelta | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const cost = asRecord(usage.cost);
  if (
    ![usage.input, usage.output, usage.cacheRead, usage.cacheWrite, cost?.total].some(
      (item) => typeof item === "number",
    )
  ) {
    return undefined;
  }
  return {
    input: finiteNumber(usage.input),
    output: finiteNumber(usage.output),
    cacheRead: finiteNumber(usage.cacheRead),
    cacheWrite: finiteNumber(usage.cacheWrite),
    cost: finiteNumber(cost?.total ?? usage.cost),
  };
}

function textFromContent(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : "";
  return value
    .filter((part) => asRecord(part)?.type === "text")
    .map((part) => {
      const text = asRecord(part)?.text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function classifyToolOutcome(raw: RawEvent): "success" | "error" | "blocked" | "aborted" {
  const result = asRecord(raw.result);
  const details = asRecord(result?.details);
  const resultText = textFromContent(result?.content).toLocaleLowerCase("en-US");
  if (details?.aborted === true || details?.abortReason !== undefined) return "aborted";
  if (/\babort(?:ed|ing)?\b/.test(resultText)) return "aborted";
  if (details?.blocked === true || details?.blockReason !== undefined) return "blocked";
  if (/\bblock(?:ed|ing)?\b|denied by user|runtime policy/.test(resultText)) return "blocked";
  return raw.isError === true ? "error" : "success";
}

export interface EvalSkillReadTarget {
  skill: string;
  ownedReadTarget: string;
}

export interface OmpEvalEventAdapterOptions {
  now?: () => number;
  /** Exact plugin-owned SKILL.md targets derived from the loaded plugin manifest. */
  skillReadTargets?: readonly EvalSkillReadTarget[];
}

function normalizeSkillName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized.startsWith("pov:") ? normalized : `pov:${normalized}`;
}

function skillFromReadArgs(
  args: unknown,
  skillByOwnedReadTarget: ReadonlyMap<string, string>,
): string | undefined {
  const record = asRecord(args);
  if (!record) return undefined;
  const candidate = [record.path, record.uri, record.url].find((item) => typeof item === "string");
  if (typeof candidate !== "string") return undefined;
  return skillByOwnedReadTarget.get(path.resolve(candidate));
}

/** Convert OMP's SDK event union into the stable evidence contract used by evals. */
export class OmpEvalEventAdapter {
  private readonly starts = new Map<string, { name: string; args: unknown }>();
  private readonly now: () => number;
  private readonly skillByOwnedReadTarget: ReadonlyMap<string, string>;

  constructor(options: OmpEvalEventAdapterOptions | (() => number) = {}) {
    const normalizedOptions = typeof options === "function" ? { now: options } : options;
    this.now = normalizedOptions.now ?? Date.now;
    const targets = new Map<string, string>();
    for (const target of normalizedOptions.skillReadTargets ?? []) {
      if (!path.isAbsolute(target.ownedReadTarget)) {
        throw new Error(
          `eval skill read target must be absolute: ${target.ownedReadTarget}`,
        );
      }
      const resolvedTarget = path.resolve(target.ownedReadTarget);
      if (path.basename(resolvedTarget).toLocaleLowerCase("en-US") !== "skill.md") {
        throw new Error(`eval skill read target must name SKILL.md: ${resolvedTarget}`);
      }
      const skill = normalizeSkillName(target.skill);
      const existing = targets.get(resolvedTarget);
      if (existing !== undefined && existing !== skill) {
        throw new Error(
          `eval skill read target is assigned to multiple skills: ${resolvedTarget}`,
        );
      }
      targets.set(resolvedTarget, skill);
    }
    this.skillByOwnedReadTarget = targets;
  }

  adapt(value: unknown): EvidenceEvent[] {
    const raw = asRecord(value);
    if (!raw) return [];
    if (raw.type === "tool_execution_start") {
      if (
        typeof raw.toolName !== "string" ||
        typeof raw.toolCallId !== "string"
      ) {
        return [];
      }
      this.starts.set(raw.toolCallId, { name: raw.toolName, args: raw.args });
      return [
        {
          type: "tool_start",
          name: raw.toolName,
          args: raw.args,
          callId: raw.toolCallId,
          at: this.now(),
        },
      ];
    }

    if (raw.type === "tool_execution_end") {
      if (
        typeof raw.toolName !== "string" ||
        typeof raw.toolCallId !== "string"
      ) {
        return [];
      }
      const start = this.starts.get(raw.toolCallId);
      this.starts.delete(raw.toolCallId);
      const outcome = classifyToolOutcome(raw);
      const resultRecord = asRecord(raw.result);
      const details = asRecord(resultRecord?.details);
      const taskUsage = raw.toolName === "task" ? readUsage(details?.usage) : undefined;
      const toolEnd: EvidenceEvent = {
        type: "tool_end",
        name: raw.toolName,
        callId: raw.toolCallId,
        outcome,
        result: raw.result,
        ...(taskUsage ? { usage: taskUsage } : {}),
        at: this.now(),
      };
      const evidence: EvidenceEvent[] = [toolEnd];
      const skill = outcome === "success" && start?.name === "read"
        ? skillFromReadArgs(start.args, this.skillByOwnedReadTarget)
        : undefined;
      if (skill) {
        evidence.push({ type: "skill_activation", skill, receipt: "read", at: this.now() });
      }
      return evidence;
    }

    if (raw.type === "message_end") {
      const message = asRecord(raw.message);
      if (message?.role !== "assistant") return [];
      const provider = typeof message.provider === "string" ? message.provider : undefined;
      const model = typeof message.model === "string" ? message.model : undefined;
      const usage = readUsage(message.usage);
      return [
        {
          type: "assistant_end",
          text: textFromContent(message.content),
          ...(usage ? { usage } : {}),
          ...(provider && model ? { model: { provider, model } } : {}),
          at: this.now(),
        },
      ];
    }

    if (raw.type === "agent_end") {
      const messages = Array.isArray(raw.messages) ? raw.messages : [];
      const lastAssistant = [...messages]
        .reverse()
        .map(asRecord)
        .find((message) => message?.role === "assistant");
      const stopReason = typeof lastAssistant?.stopReason === "string"
        ? lastAssistant.stopReason
        : undefined;
      return [{ type: "turn_end", ...(stopReason ? { stopReason } : {}), at: this.now() }];
    }

    if (
      raw.type === "skill_activation" &&
      typeof raw.skill === "string" &&
      typeof raw.ownedReadTarget === "string"
    ) {
      if (raw.receipt !== "selection" && raw.receipt !== "read") return [];
      const configuredSkill = this.skillByOwnedReadTarget.get(
        path.resolve(raw.ownedReadTarget),
      );
      if (
        configuredSkill === undefined ||
        configuredSkill !== normalizeSkillName(raw.skill)
      ) {
        return [];
      }
      return [
        {
          type: "skill_activation",
          skill: configuredSkill,
          receipt: raw.receipt,
          at: this.now(),
        },
      ];
    }

    if (
      raw.type === "error" ||
      raw.type === "session_error" ||
      raw.type === "stream_error" ||
      raw.type === "abort"
    ) {
      const code = typeof raw.code === "string" ? raw.code : String(raw.type);
      return [{ type: "terminal_error", code, at: this.now() }];
    }

    return [];
  }
}
import path from "node:path";
