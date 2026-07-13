import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import path from "node:path";
import {
  loadSkillKeywordIndex,
  matchSkillsForText,
} from "../../../.omp/extensions/pi-oven-runtime/skill-keyword-loader";
import {
  EXPLICIT_SKILL_SAFETY_CEILING,
  ExplicitSkillSafetyCeilingError,
  hasExplicitSkillAlias,
  selectSkillsForTurn,
  type SkillSelectionIndexEntry,
  type SkillSelectionReceipt,
} from "../../../.omp/extensions/pi-oven-runtime/skill-selection";

function entry(
  local: string,
  manifestOrder: number,
  phrases: string[] = [`phrase-${manifestOrder}`]
): SkillSelectionIndexEntry {
  return {
    name: `pov:${local}`,
    description: local,
    phrases,
    ownedReadTarget: `/plugin/skills/${local}/SKILL.md`,
    pluginRoot: "/plugin",
    manifestOrder,
  };
}

function semanticReceipt(receipt: SkillSelectionReceipt) {
  return {
    explicit: receipt.explicit.map((skill) => skill.name),
    implicitRoot: receipt.implicitRoot.map((skill) => skill.name),
    deferred: receipt.deferred.map((skill) => skill.name),
    dropped: receipt.dropped.map((skill) => [skill.name, skill.reason]),
    maxImplicitRoots: receipt.maxImplicitRoots,
  };
}

describe("explicit-first skill selection", () => {
  it("collects every keyword candidate before applying a root budget", () => {
    const index = Array.from({ length: 10 }, (_, manifestOrder) => ({
      name: `pov:skill-${manifestOrder}`,
      description: `skill ${manifestOrder}`,
      phrases: [`phrase-${manifestOrder}`],
      ownedReadTarget: `/plugin/skills/skill-${manifestOrder}/SKILL.md`,
      pluginRoot: "/plugin",
      manifestOrder,
    }));

    expect(
      matchSkillsForText(index.map((entry) => entry.phrases[0]).join(" "), index)
    ).toHaveLength(10);
  });

  it("recalls every shipped skill through each explicit alias without a keyword hit", () => {
    const index = loadSkillKeywordIndex(path.resolve(__dirname, "../../.."));

    for (const entry of index) {
      const local = entry.name.slice("pov:".length);
      for (const alias of [`pov:${local}`, `$${local}`, `/${local}`]) {
        const receipt = selectSkillsForTurn({
          latestUserText: `please load ${alias} now`,
          index,
          maxImplicitRoots: 0,
        });
        expect(receipt.explicit.map((skill) => skill.name)).toEqual([entry.name]);
      }
    }
  });

  it("requires token boundaries for explicit aliases and deduplicates repeated aliases", () => {
    const index = [entry("tdd-strict", 0, ["test first"])];
    for (const falsePositive of [
      "xpov:tdd-strict",
      "pov:tdd-strict-extra",
      "x$tdd-strict",
      "$tdd-strict-extra",
      "path/$tdd-strict/file",
      "path/tdd-strict/file",
    ]) {
      expect(hasExplicitSkillAlias(falsePositive, "pov:tdd-strict")).toBe(false);
    }

    const receipt = selectSkillsForTurn({
      latestUserText: "`POV:TDD-STRICT`, $tdd-strict, and /tdd-strict test first",
      index,
      maxImplicitRoots: 8,
    });
    expect(receipt.explicit.map((skill) => skill.name)).toEqual(["pov:tdd-strict"]);
    expect(receipt.implicitRoot).toEqual([]);
    expect(receipt.deferred).toEqual([]);
  });

  it("keeps an explicit autonomous skill at root after nine earlier implicit matches", () => {
    const implicit = Array.from({ length: 9 }, (_, order) => entry(`implicit-${order}`, order));
    const autonomous = entry("autonomous-loop", 9, ["full auto"]);
    const receipt = selectSkillsForTurn({
      latestUserText: `${implicit.map((candidate) => candidate.phrases[0]).join(" ")} pov:autonomous-loop`,
      index: [...implicit, autonomous],
      maxImplicitRoots: 1,
    });

    expect(receipt.explicit.map((skill) => skill.name)).toEqual(["pov:autonomous-loop"]);
    expect(receipt.deferred).toHaveLength(9);
  });

  it("selects the worst autonomous fixture with autonomous-loop as a root", () => {
    const index = loadSkillKeywordIndex(path.resolve(__dirname, "../../.."));
    const receipt = selectSkillsForTurn({
      latestUserText:
        "자율 실행으로 큰 작업 계획 실행해줘. spec 잡자, tdd, 코드 수정, 최종 검증, 커밋 전 점검까지 멈추지 말고 진행해.",
      index,
      maxImplicitRoots: 2,
    });

    expect([...receipt.explicit, ...receipt.implicitRoot].map((skill) => skill.name)).toContain(
      "pov:autonomous-loop"
    );
  });

  it("is semantically invariant to index permutation", () => {
    const index = [
      entry("brainstorming", 0, ["brainstorm"]),
      entry("systematic-debugging", 1, ["debug this"]),
      entry("autonomous-loop", 2, ["full auto"]),
      entry("spec-and-review", 3, ["write a spec"]),
      entry("tdd-strict", 4, ["test first"]),
    ];
    const input = {
      latestUserText: "full auto, brainstorm, debug this, write a spec, test first, $tdd-strict",
      maxImplicitRoots: 2,
    };
    const expected = semanticReceipt(selectSkillsForTurn({ ...input, index }));

    fc.assert(
      fc.property(
        fc.shuffledSubarray(index, { minLength: index.length, maxLength: index.length }),
        (permuted) => {
          expect(semanticReceipt(selectSkillsForTurn({ ...input, index: permuted }))).toEqual(expected);
        }
      ),
      { seed: 20260713, numRuns: 50 }
    );
  });

  it("throws the same diagnostic instead of slicing explicit skills above the safety ceiling", () => {
    const index = Array.from({ length: EXPLICIT_SKILL_SAFETY_CEILING + 1 }, (_, order) =>
      entry(`explicit-${order.toString().padStart(2, "0")}`, order, [])
    );
    const latestUserText = index.map((candidate) => candidate.name).join(" ");
    const capture = (candidateIndex: SkillSelectionIndexEntry[]) => {
      try {
        selectSkillsForTurn({ latestUserText, index: candidateIndex, maxImplicitRoots: 8 });
        throw new Error("expected explicit safety ceiling error");
      } catch (error) {
        expect(error).toBeInstanceOf(ExplicitSkillSafetyCeilingError);
        return error as ExplicitSkillSafetyCeilingError;
      }
    };

    const forward = capture(index);
    const reverse = capture([...index].reverse());
    expect(forward.message).toBe(reverse.message);
    expect(forward.explicitSkills).toHaveLength(EXPLICIT_SKILL_SAFETY_CEILING + 1);
  });

  it("places every candidate in exactly one receipt bucket", () => {
    const index = [
      entry("autonomous-loop", 0, ["full auto"]),
      entry("systematic-debugging", 1, ["debug this"]),
      entry("spec-and-review", 2, ["write a spec"]),
      entry("tdd-strict", 3, ["test first", "test first"]),
      entry("fresh-verifier", 4, ["fresh verify"]),
    ];
    const receipt = selectSkillsForTurn({
      latestUserText:
        "full auto debug this write a spec test first fresh verify $tdd-strict /tdd-strict",
      index,
      maxImplicitRoots: 2,
    });
    const names = [
      ...receipt.explicit,
      ...receipt.implicitRoot,
      ...receipt.deferred,
      ...receipt.dropped,
    ].map((skill) => skill.name);

    expect(names).toHaveLength(index.length);
    expect(new Set(names).size).toBe(index.length);
    expect([...names].sort()).toEqual(index.map((candidate) => candidate.name).sort());
  });

  it("keeps selection invariant across generated phrase order, whitespace, and case variations", () => {
    const baseIndex = [
      entry("autonomous-loop", 0, ["full auto", "FULL   AUTO"]),
      entry("systematic-debugging", 1, ["debug this"]),
      entry("spec-and-review", 2, ["write a spec"]),
      entry("tdd-strict", 3, ["test first"]),
    ];
    const phrases = ["full auto", "debug this", "write a spec", "$tdd-strict"];
    const expected = semanticReceipt(
      selectSkillsForTurn({
        latestUserText: phrases.join(" "),
        index: baseIndex,
        maxImplicitRoots: 2,
      })
    );

    fc.assert(
      fc.property(
        fc.shuffledSubarray(phrases, { minLength: phrases.length, maxLength: phrases.length }),
        fc.shuffledSubarray(baseIndex, { minLength: baseIndex.length, maxLength: baseIndex.length }),
        fc.integer({ min: 1, max: 5 }),
        fc.boolean(),
        (phraseOrder, indexOrder, spaces, uppercase) => {
          const rendered = phraseOrder
            .map((phrase) => (uppercase ? phrase.toUpperCase() : phrase))
            .join(" ".repeat(spaces));
          expect(
            semanticReceipt(
              selectSkillsForTurn({
                latestUserText: rendered,
                index: indexOrder,
                maxImplicitRoots: 2,
              })
            )
          ).toEqual(expected);
        }
      ),
      { seed: 20260713, numRuns: 100 }
    );
  });
});
