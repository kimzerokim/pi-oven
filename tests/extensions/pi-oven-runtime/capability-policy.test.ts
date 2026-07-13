import { describe, expect, it } from "bun:test";
import { DEFAULT_PROFILE } from "../../../scripts/pi-oven-setup/profiles";
import {
  CAPABILITY_RULES,
  CAPABILITY_POLICY_VERSION,
  getCapabilityRule,
} from "../../../.omp/extensions/pi-oven-runtime/capability-registry";
import { evaluateCapabilityPolicy } from "../../../.omp/extensions/pi-oven-runtime/capability-policy";

describe("versioned capability policy", () => {
  it("maps every tool granted to a shipped agent to a classified policy rule", () => {
    expect(CAPABILITY_POLICY_VERSION).toBe(1);
    const shippedTools = new Set(
      Object.values(DEFAULT_PROFILE).flatMap((profile) => profile.tools)
    );

    for (const toolName of shippedTools) {
      const rule = getCapabilityRule(toolName);
      expect(rule, `missing policy rule for ${toolName}`).toBeDefined();
      if (!rule) throw new Error(`missing policy rule for ${toolName}`);
      expect(rule.toolName).toBe(toolName);
      expect(rule.audiences).toContain("worker");
      expect(["read", "local-write", "external-read", "external-mutation"]).toContain(
        rule.risk
      );
    }
    expect(getCapabilityRule("irc")).toBeDefined();
    expect(getCapabilityRule("pi-oven_ask")?.capability).toBe("ask");
  });

  it("denies an unknown tool by default during autonomous execution", () => {
    const decision = evaluateCapabilityPolicy({
      toolName: "mystery_tool",
      input: {},
      mode: "autonomous",
      audience: "worker",
    });

    expect(decision.block).toBe(true);
    expect(decision.reason).toMatch(/unknown tool.*autonomous.*default deny/i);
  });

  it("requires a policy update for an unknown interactive mutation", () => {
    const decision = evaluateCapabilityPolicy({
      toolName: "cloud_deploy",
      input: { action: "deploy" },
      mode: "interactive",
      audience: "parent",
    });

    expect(decision.block).toBe(true);
    expect(decision.reason).toMatch(/unknown mutation.*policy/i);
  });

  it("keeps the interactive allowlist fail-closed and identifies write-shaped unknown calls", () => {
    const readLike = evaluateCapabilityPolicy({
      toolName: "project_metadata",
      input: { path: "README.md" },
      mode: "interactive",
      audience: "parent",
    });
    const writeLike = evaluateCapabilityPolicy({
      toolName: "project_metadata",
      input: { path: "README.md", content: "replacement" },
      mode: "interactive",
      audience: "parent",
    });

    expect(readLike.block).toBe(true);
    expect(readLike.reason).toMatch(/no classified interactive policy rule/i);
    expect(writeLike.block).toBe(true);
    expect(writeLike.reason).toMatch(/unknown mutation/i);
  });

  it("denies malformed known-tool arguments and allows a minimally valid safe read", () => {
    const malformed = evaluateCapabilityPolicy({
      toolName: "read",
      input: {},
      mode: "interactive",
      audience: "worker",
    });
    const safe = evaluateCapabilityPolicy({
      toolName: "read",
      input: { path: "README.md" },
      mode: "autonomous",
      audience: "worker",
    });

    expect(malformed.block).toBe(true);
    expect(malformed.reason).toMatch(/malformed arguments/i);
    expect(safe.block).toBe(false);
    expect(safe.rule?.risk).toBe("read");
    expect(safe.approval).toBe("none");
  });

  it("gives every rule a fail-closed argument validator and approval classification", () => {
    for (const rule of CAPABILITY_RULES) {
      expect(rule.validateArgs(null).valid, `${rule.toolName} accepted null input`).toBe(false);
      if (rule.risk === "read" || rule.risk === "external-read") {
        expect(rule.approval).toBe("none");
      }
      if (rule.risk === "external-mutation") {
        expect(rule.approval).toBe("user-consent");
      }
    }
  });

  it("fails closed when argument inspection itself throws", () => {
    const hostileInput = new Proxy({}, {
      get() {
        throw new Error("untrusted getter");
      },
    });

    const decision = evaluateCapabilityPolicy({
      toolName: "read",
      input: hostileInput,
      mode: "interactive",
      audience: "parent",
    });

    expect(decision.block).toBe(true);
    expect(decision.reason).toMatch(/validation failed closed/i);
  });
});
