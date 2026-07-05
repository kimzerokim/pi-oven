export const CAPABILITY_IDS = [
  "code_write",
  "owned_write_lane",
  "shared_write_lane",
  "external_read",
  "external_mutation",
  "ask",
  "autonomous_continuation",
  "verification_completion",
  "debug_trace",
  "release_install_sync",
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export const CAPABILITY_TAGS = ["deep-interview", "verification", "runtime-routing", "gate"] as const;

export type CapabilityTag = (typeof CAPABILITY_TAGS)[number];

export const CAPABILITY_TAGS_BY_ID: Readonly<Record<CapabilityId, readonly CapabilityTag[]>> = {
  code_write: ["gate", "runtime-routing"],
  owned_write_lane: ["runtime-routing"],
  shared_write_lane: ["runtime-routing"],
  external_read: ["gate", "runtime-routing"],
  external_mutation: ["gate", "runtime-routing"],
  ask: ["deep-interview", "runtime-routing"],
  autonomous_continuation: ["verification", "runtime-routing"],
  verification_completion: ["verification", "runtime-routing"],
  debug_trace: ["verification", "runtime-routing"],
  release_install_sync: ["verification", "runtime-routing"],
};

const CAPABILITIES_BY_TAG: Readonly<Record<CapabilityTag, readonly CapabilityId[]>> = {
  "deep-interview": CAPABILITY_IDS.filter((capability) =>
    CAPABILITY_TAGS_BY_ID[capability].includes("deep-interview")
  ),
  verification: CAPABILITY_IDS.filter((capability) =>
    CAPABILITY_TAGS_BY_ID[capability].includes("verification")
  ),
  "runtime-routing": CAPABILITY_IDS.filter((capability) =>
    CAPABILITY_TAGS_BY_ID[capability].includes("runtime-routing")
  ),
  gate: CAPABILITY_IDS.filter((capability) => CAPABILITY_TAGS_BY_ID[capability].includes("gate")),
};

export function getCapabilityTags(capability: CapabilityId): readonly CapabilityTag[] {
  return CAPABILITY_TAGS_BY_ID[capability];
}

export function getCapabilitiesByTag(tag: CapabilityTag): readonly CapabilityId[] {
  return CAPABILITIES_BY_TAG[tag];
}
