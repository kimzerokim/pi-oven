import { describe, expect, it } from "bun:test";
import { paneHasActiveTask, paneLooksReady, waitForPaneReady } from "../../../scripts/pi-oven-team/tmux-session";

describe("pi-oven-team/tmux-session", () => {
  it("detects interactive readiness but not bootstrapping output", () => {
    expect(paneLooksReady("loading model...\nconnecting to provider\n")).toBe(false);
    expect(paneLooksReady("some output\n❯ ")).toBe(true);
  });

  it("treats active-task panes as not yet dispatchable", () => {
    expect(paneHasActiveTask("background terminal running\n❯ ")).toBe(true);
    expect(paneHasActiveTask("idle output\n❯ ")).toBe(false);
  });

  it("waits for a pane to become ready before returning true", async () => {
    const captures = [
      "loading model...\n",
      "initializing\n",
      "some output\n❯ ",
    ];
    const tmux = {
      async capturePane(_paneId: string) {
        return captures.shift() ?? "❯ ";
      },
    };

    const ready = await waitForPaneReady(tmux, "%2", { timeoutMs: 50, pollIntervalMs: 1 });
    expect(ready).toBe(true);
  });
});
