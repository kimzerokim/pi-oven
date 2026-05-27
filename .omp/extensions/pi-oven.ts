import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function piOvenPi(pi: ExtensionAPI): void {
  pi.setLabel("pi-oven v0.1.0 (Plan 0 scaffold)");
  pi.logger.info("pi-oven loaded (no-op scaffold)");
}
