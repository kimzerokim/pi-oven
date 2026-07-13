import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicReplaceFile,
  durableRemoveFile,
} from "../../../scripts/lib/atomic-file";
import {
  ABSENT,
  applySetupTransaction,
  inspectSetupTransaction,
  isAbsentSnapshot,
  recoverSetupTransactions,
  createSetupTransactionResourceAdapter,
  recoverSetupTransactionsOnStartup,
  resolveSetupTransactionStateDir,
  type SetupTransactionResourceAdapter,
  type SetupTransactionSnapshot,
} from "../../../scripts/pi-oven-setup/setup-transaction";
import { runApply } from "../../../scripts/pi-oven-setup/apply";

const roots: string[] = [];

function makeRoot(): string {
  const root = join(
    tmpdir(),
    `pi-oven-setup-transaction-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("atomicReplaceFile", () => {
  it("durably replaces a file without leaving a fixed or generated temp file", async () => {
    const root = makeRoot();
    const target = join(root, "nested", "state.json");

    await atomicReplaceFile(target, '{"value":1}\n');
    await atomicReplaceFile(target, '{"value":2}\n');

    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe('{"value":2}\n');
    expect(readdirSync(join(root, "nested"))).toEqual(["state.json"]);
  });

  it("cleans only its unique temp file when a synced replace faults before rename", async () => {
    const root = makeRoot();
    const target = join(root, "state.json");
    writeFileSync(target, "original");

    await expect(
      atomicReplaceFile(target, "desired", {
        fault: (point) => {
          if (point === "after_temp_sync") throw new Error("atomic fault");
        },
      })
    ).rejects.toThrow("atomic fault");

    expect(readFileSync(target, "utf8")).toBe("original");
    expect(readdirSync(root)).toEqual(["state.json"]);
  });

  it("durably removing an already-absent file is idempotent", async () => {
    const root = makeRoot();
    await durableRemoveFile(join(root, "absent.json"));
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("applySetupTransaction", () => {
  it("commits only after live desired-state validation and keeps a stable rerun hash", async () => {
    const root = makeRoot();
    const values = new Map<string, SetupTransactionSnapshot>([
      ["routing", { keep: "unrelated", old: true }],
      ["receipt", ABSENT],
    ]);
    const adapter: SetupTransactionResourceAdapter = {
      read: async (resource) => structuredClone(values.get(resource) ?? ABSENT),
      write: async (resource, value) => {
        if (isAbsentSnapshot(value)) values.delete(resource);
        else values.set(resource, structuredClone(value));
      },
    };
    let validations = 0;
    const run = () =>
      applySetupTransaction({
        scope: "project",
        operation: "apply",
        stateDir: root,
        adapter,
        desired: { routing: { keep: "unrelated", selected: "codex" } },
        receipt: { resource: "receipt", value: { setupComplete: true } },
        validate: async () => {
          validations += 1;
          expect(values.get("routing")).toEqual({ keep: "unrelated", selected: "codex" });
          return { ok: true };
        },
      });

    const first = await run();
    const second = await run();

    expect(first.desiredHash).toBe(second.desiredHash);
    expect(first.phase).toBe("committed");
    expect(values.get("receipt")).toEqual({ setupComplete: true });
    expect(validations).toBe(2);
  });

  const faultPoints = [
    "journal_write",
    "forward:first",
    "forward:second",
    "validation",
    "receipt_write",
  ] as const;

  for (const faultPoint of faultPoints) {
    it(`restores byte/value semantics after ${faultPoint}`, async () => {
      const root = makeRoot();
      const values = new Map<string, SetupTransactionSnapshot>([
        ["first", { unrelated: true, original: 1 }],
        ["receipt", { language: "ko" }],
      ]);
      const adapter: SetupTransactionResourceAdapter = {
        read: async (resource) => structuredClone(values.get(resource) ?? ABSENT),
        write: async (resource, value) => {
          if (isAbsentSnapshot(value)) values.delete(resource);
          else values.set(resource, structuredClone(value));
        },
      };

      await expect(
        applySetupTransaction({
          scope: "global",
          operation: "apply",
          stateDir: root,
          adapter,
          desired: { first: { unrelated: true, desired: 2 }, second: "created" },
          receipt: { resource: "receipt", value: { language: "ko", setup: true } },
          validate: async () => ({ ok: true }),
          fault: (point) => {
            if (point === faultPoint) throw new Error(`fault:${point}`);
          },
        })
      ).rejects.toThrow(`fault:${faultPoint}`);

      expect(values.get("first")).toEqual({ unrelated: true, original: 1 });
      expect(values.has("second")).toBe(false);
      expect(values.get("receipt")).toEqual({ language: "ko" });
      expect(await inspectSetupTransaction(root)).toEqual({ state: "healthy" });
    });
  }

  it("resumes a rollback interrupted immediately after each compensation", async () => {
    const root = makeRoot();
    const values = new Map<string, SetupTransactionSnapshot>([["first", "original"]]);
    const adapter: SetupTransactionResourceAdapter = {
      read: async (resource) => structuredClone(values.get(resource) ?? ABSENT),
      write: async (resource, value) => {
        if (isAbsentSnapshot(value)) values.delete(resource);
        else values.set(resource, structuredClone(value));
      },
    };
    let rollbackInterrupted = false;
    await expect(
      applySetupTransaction({
        scope: "project",
        operation: "apply",
        stateDir: root,
        adapter,
        desired: { first: "desired", second: "created" },
        fault: (point) => {
          if (point === "forward:second") throw new Error("start rollback");
          if (point === "compensation:second" && !rollbackInterrupted) {
            rollbackInterrupted = true;
            throw new Error("rollback killed");
          }
        },
      })
    ).rejects.toThrow("rollback killed");

    expect((await inspectSetupTransaction(root)).state).toBe("recovery_needed");
    expect(await recoverSetupTransactions({ stateDir: root, adapter })).toEqual({ state: "recovered" });
    expect(values.get("first")).toBe("original");
    expect(values.has("second")).toBe(false);
  });

  it("does not overwrite a concurrent edit and leaves an explicit manual diff", async () => {
    const root = makeRoot();
    const values = new Map<string, SetupTransactionSnapshot>([["routing", "original"]]);
    const adapter: SetupTransactionResourceAdapter = {
      read: async (resource) => structuredClone(values.get(resource) ?? ABSENT),
      write: async (resource, value) => {
        if (isAbsentSnapshot(value)) values.delete(resource);
        else values.set(resource, structuredClone(value));
      },
    };

    await expect(
      applySetupTransaction({
        scope: "global",
        operation: "apply",
        stateDir: root,
        adapter,
        desired: { routing: "desired" },
        fault: (point) => {
          if (point === "forward:routing") {
            values.set("routing", "concurrent-user-edit");
            throw new Error("fail after concurrent edit");
          }
        },
      })
    ).rejects.toThrow(/manual recovery/i);

    expect(values.get("routing")).toBe("concurrent-user-edit");
    expect((await inspectSetupTransaction(root)).state).toBe("rollback_failed");
  });

  it("allows only one competing setup lock owner", async () => {
    const root = makeRoot();
    const values = new Map<string, SetupTransactionSnapshot>();
    const adapter: SetupTransactionResourceAdapter = {
      read: async (resource) => structuredClone(values.get(resource) ?? ABSENT),
      write: async (resource, value) => {
        values.set(resource, structuredClone(value));
      },
    };
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    let entered!: () => void;
    const validationEntered = new Promise<void>((resolve) => { entered = resolve; });
    const first = applySetupTransaction({
      scope: "project",
      operation: "apply",
      stateDir: root,
      adapter,
      desired: { routing: "desired" },
      validate: async () => {
        entered();
        await blocked;
        return { ok: true };
      },
    });
    await validationEntered;

    await expect(
      applySetupTransaction({
        scope: "project",
        operation: "apply",
        stateDir: root,
        adapter,
        desired: { routing: "other" },
      })
    ).rejects.toThrow(/another setup transaction/i);
    unblock();
    await first;
  });
});

const globalSetupKeys = [
  "modelRoles",
  "retry.fallbackChains",
  "task.agentModelOverrides",
  "skills.includeSkills",
  "memory.backend",
  "mnemopi.noEmbeddings",
  "mnemopi.llmMode",
  "async.enabled",
  "task.enableLsp",
  "inspect_image.enabled",
  "web_search.enabled",
  "lsp.enabled",
  "astGrep.enabled",
  "browser.enabled",
  "debug.enabled",
] as const;

function makeStatefulSpawn(initial: Record<string, unknown>) {
  const values = new Map(Object.entries(structuredClone(initial)));
  const spawnFn = (_cmd: string, args: string[]) => {
    if (args[0] === "config" && args[1] === "get") {
      if (!values.has(args[2])) {
        return { exitCode: 1, stdout: Buffer.from(""), stderr: Buffer.from("missing key") };
      }
      const value = values.get(args[2]);
      return {
        exitCode: 0,
        stdout: Buffer.from(JSON.stringify({ value, type: Array.isArray(value) ? "array" : "record" })),
        stderr: Buffer.from(""),
      };
    }
    if (args[0] === "config" && args[1] === "set") {
      try {
        values.set(args[2], JSON.parse(args[3]));
      } catch {
        values.set(args[2], args[3]);
      }
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    }
    if (args[0] === "config" && args[1] === "reset") {
      values.delete(args[2]);
      return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
    }
    return { exitCode: 0, stdout: Buffer.from(""), stderr: Buffer.from("") };
  };
  return { values, spawnFn };
}

describe("runApply transaction fault matrix", () => {
  const forwardPoints = [
    "journal_write",
    ...globalSetupKeys.map((key) => `forward:config:${key}` as const),
    "validation",
    "receipt_write",
  ] as const;

  for (const faultPoint of forwardPoints) {
    it(`never leaves partial global desired state after ${faultPoint}`, async () => {
      const homeDir = makeRoot();
      mkdirSync(join(homeDir, ".pi-oven"), { recursive: true });
      const receiptFile = join(homeDir, ".pi-oven", "config.json");
      const originalReceipt = '{ "language" : "ko", "unrelated": true }\n';
      writeFileSync(receiptFile, originalReceipt);
      const initial = {
        modelRoles: { custom: "keep" },
        "retry.fallbackChains": { custom: ["keep"] },
        "task.agentModelOverrides": { "user:custom": "keep" },
        "memory.backend": "user-memory",
        "debug.enabled": false,
      };
      const { values, spawnFn } = makeStatefulSpawn(initial);

      await expect(
        runApply({
          scope: "global",
          homeDir,
          cwd: homeDir,
          validateMode: "none",
          spawnFn,
          transactionFault: (point) => {
            if (point === faultPoint) throw new Error(`fault:${point}`);
          },
        })
      ).rejects.toThrow(`fault:${faultPoint}`);

      expect(Object.fromEntries(values)).toEqual(initial);
      expect(readFileSync(receiptFile, "utf8")).toBe(originalReceipt);
      expect(
        (
          await inspectSetupTransaction(
            resolveSetupTransactionStateDir({ scope: "global", homeDir })
          )
        ).state
      ).toBe("healthy");
    });
  }

  it("restores the exact project bytes after the single project replace faults", async () => {
    const cwd = makeRoot();
    mkdirSync(join(cwd, ".omp"), { recursive: true });
    const settingsFile = join(cwd, ".omp", "settings.json");
    const original = '{ "extensions": ["keep"], "user": { "x": 1 } }\n';
    writeFileSync(settingsFile, original);
    const point = `forward:file:${settingsFile}` as const;

    await expect(
      runApply({
        scope: "project",
        cwd,
        validateMode: "none",
        transactionFault: (faultPoint) => {
          if (faultPoint === point) throw new Error("project replace fault");
        },
      })
    ).rejects.toThrow("project replace fault");

    expect(readFileSync(settingsFile, "utf8")).toBe(original);
    expect(existsSync(join(cwd, ".pi-oven", "config.json"))).toBe(false);
  });

  for (const compensationTarget of [
    ...globalSetupKeys.map((key) => `config:${key}`),
    "receipt",
  ]) {
    it(`next entry resumes a rollback killed after compensation:${compensationTarget}`, async () => {
      const homeDir = makeRoot();
      mkdirSync(join(homeDir, ".pi-oven"), { recursive: true });
      const receiptFile = join(homeDir, ".pi-oven", "config.json");
      const originalReceipt = '{"language":"en"}\n';
      writeFileSync(receiptFile, originalReceipt);
      const initial = {
        modelRoles: { custom: "keep" },
        "retry.fallbackChains": { custom: ["keep"] },
        "task.agentModelOverrides": { "user:custom": "keep" },
        "debug.enabled": false,
      };
      const { values, spawnFn } = makeStatefulSpawn(initial);
      const receiptResource = `file:${receiptFile}`;
      const target = compensationTarget === "receipt" ? receiptResource : compensationTarget;
      let startedRollback = false;

      await expect(
        runApply({
          scope: "global",
          homeDir,
          cwd: homeDir,
          validateMode: "none",
          spawnFn,
          transactionFault: (point) => {
            if (!startedRollback && compensationTarget === "receipt" && point === "receipt_write") {
              startedRollback = true;
              throw new Error("begin receipt rollback");
            }
            if (
              !startedRollback &&
              compensationTarget !== "receipt" &&
              point === "forward:config:debug.enabled"
            ) {
              startedRollback = true;
              throw new Error("begin config rollback");
            }
            if (startedRollback && point === `compensation:${target}`) {
              throw new Error(`killed after compensation:${target}`);
            }
          },
        })
      ).rejects.toThrow(`killed after compensation:${target}`);

      const health = await recoverSetupTransactionsOnStartup({
        cwd: join(homeDir, "project"),
        homeDir,
        spawnFn,
      });
      expect(health.find(({ scope }) => scope === "global")?.recovered).toBe(true);
      expect(Object.fromEntries(values)).toEqual(initial);
      expect(readFileSync(receiptFile, "utf8")).toBe(originalReceipt);
    });
  }
});

describe("process-kill recovery", () => {
  it("recovers a forward write left by a killed process", async () => {
    const root = makeRoot();
    const target = join(root, "target.txt");
    const stateDir = join(root, "state");
    writeFileSync(target, "original");
    const moduleUrl = new URL(
      "../../../scripts/pi-oven-setup/setup-transaction.ts",
      import.meta.url
    ).href;
    const resource = `file:${target}`;
    const script = `
      import { applySetupTransaction, createSetupTransactionResourceAdapter } from ${JSON.stringify(moduleUrl)};
      await applySetupTransaction({
        scope: "project", operation: "apply", stateDir: ${JSON.stringify(stateDir)},
        adapter: createSetupTransactionResourceAdapter(),
        desired: { ${JSON.stringify(resource)}: { content: "desired" } },
        fault: (point) => { if (point === ${JSON.stringify(`forward:${resource}`)}) process.exit(91); }
      });
    `;
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(91);
    expect(readFileSync(target, "utf8")).toBe("desired");

    expect(
      await recoverSetupTransactions({
        stateDir,
        adapter: createSetupTransactionResourceAdapter(),
      })
    ).toEqual({ state: "recovered" });
    expect(readFileSync(target, "utf8")).toBe("original");
  });

  it("resumes when the process is killed during rollback compensation", async () => {
    const root = makeRoot();
    const first = join(root, "first.txt");
    const second = join(root, "second.txt");
    const stateDir = join(root, "state");
    writeFileSync(first, "first-original");
    writeFileSync(second, "second-original");
    const moduleUrl = new URL(
      "../../../scripts/pi-oven-setup/setup-transaction.ts",
      import.meta.url
    ).href;
    const firstResource = `file:${first}`;
    const secondResource = `file:${second}`;
    const script = `
      import { applySetupTransaction, createSetupTransactionResourceAdapter } from ${JSON.stringify(moduleUrl)};
      await applySetupTransaction({
        scope: "project", operation: "apply", stateDir: ${JSON.stringify(stateDir)},
        adapter: createSetupTransactionResourceAdapter(),
        desired: {
          ${JSON.stringify(firstResource)}: { content: "first-desired" },
          ${JSON.stringify(secondResource)}: { content: "second-desired" }
        },
        fault: (point) => {
          if (point === ${JSON.stringify(`forward:${secondResource}`)}) throw new Error("rollback");
          if (point === ${JSON.stringify(`compensation:${secondResource}`)}) process.exit(92);
        }
      });
    `;
    const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(92);

    await recoverSetupTransactions({
      stateDir,
      adapter: createSetupTransactionResourceAdapter(),
    });
    expect(readFileSync(first, "utf8")).toBe("first-original");
    expect(readFileSync(second, "utf8")).toBe("second-original");
  });
});
