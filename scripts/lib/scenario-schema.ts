import { z } from "zod";

const NonEmptyString = z.string().trim().min(1);
const NonEmptyStringList = z.array(NonEmptyString).min(1);

export const ScenarioTurnSchema = z
  .object({
    turn: z.number().int().positive(),
    user: NonEmptyString,
  })
  .strict();

/**
 * An expectation is deliberately a small, strict vocabulary. Fields prefixed
 * with `observe_` produce telemetry only; every other field is a hard gate.
 */
export const ScenarioExpectationSchema = z
  .object({
    response_must_contain: NonEmptyStringList.optional(),
    response_must_contain_match: z.enum(["all", "any"]).optional(),
    response_must_not_contain: NonEmptyStringList.optional(),
    tool_call_required: z
      .object({
        namePattern: NonEmptyString,
        args: z.unknown().optional(),
      })
      .strict()
      .optional(),
    skill_activation_required: NonEmptyString.optional(),
    observe_response_contains: NonEmptyStringList.optional(),
    observe_tool_call: z
      .object({
        namePattern: NonEmptyString,
        args: z.unknown().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((expectation, context) => {
    if (
      expectation.response_must_contain_match !== undefined &&
      expectation.response_must_contain === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "response_must_contain_match requires response_must_contain",
      });
    }

    if (Object.values(expectation).every((value) => value === undefined)) {
      context.addIssue({ code: "custom", message: "expectation must contain an assertion or observation" });
    }

    for (const field of ["tool_call_required", "observe_tool_call"] as const) {
      const tool = expectation[field];
      if (tool === undefined) continue;
      try {
        new RegExp(tool.namePattern, "i");
      } catch {
        context.addIssue({
          code: "custom",
          path: [field, "namePattern"],
          message: `${field}.namePattern must be a valid regular expression`,
        });
      }
    }
  });

export type ScenarioTurn = z.infer<typeof ScenarioTurnSchema>;
export type ScenarioExpectation = z.infer<typeof ScenarioExpectationSchema>;

export function hasHardPositiveAssertion(scenario: Pick<Scenario, "expected">): boolean {
  return scenario.expected.some(
    (expectation) =>
      expectation.response_must_contain !== undefined ||
      expectation.tool_call_required !== undefined ||
      expectation.skill_activation_required !== undefined,
  );
}

export function hasHardNegativeAssertion(scenario: Pick<Scenario, "expected">): boolean {
  return scenario.expected.some((expectation) => expectation.response_must_not_contain !== undefined);
}

const ScenarioBaseSchema = z
  .object({
    name: NonEmptyString,
    skill: NonEmptyString,
    kind: z.enum(["positive", "negative"]),
    tag: z.enum(["smoke", "adversarial", "regression", "canary"]),
    description: NonEmptyString.optional(),
    input: z.array(ScenarioTurnSchema).min(1),
    expected: z.array(ScenarioExpectationSchema).min(1),
    turn_timeout_ms: z.number().int().positive().optional(),
    scenario_timeout_ms: z.number().int().positive().optional(),
  })
  .strict();

export const ScenarioSchema = ScenarioBaseSchema.superRefine((scenario, context) => {
  const positive = hasHardPositiveAssertion(scenario);
  const negative = hasHardNegativeAssertion(scenario);

  if (scenario.kind === "positive" && !positive) {
    context.addIssue({
      code: "custom",
      path: ["expected"],
      message: "positive scenario requires at least one hard positive assertion",
    });
  }

  if (scenario.kind === "negative" && positive) {
    context.addIssue({
      code: "custom",
      path: ["expected"],
      message: "kind: negative is reserved for pure negative scenarios",
    });
  }

  if (scenario.kind === "negative" && !negative) {
    context.addIssue({
      code: "custom",
      path: ["expected"],
      message: "negative scenario requires at least one hard negative assertion",
    });
  }

  const turns = scenario.input.map(({ turn }) => turn);
  if (new Set(turns).size !== turns.length) {
    context.addIssue({ code: "custom", path: ["input"], message: "turn numbers must be unique" });
  }
});

export type Scenario = z.infer<typeof ScenarioBaseSchema>;

export interface Verdict {
  scenario: string;
  skill: string;
  passed: boolean;
  inconclusive: boolean;
  failures: string[];
  observations: string[];
  latency_ms: number;
  token_in: number;
  token_out: number;
  cache_read: number;
  cache_write: number;
  cost: number;
  timed_out: boolean;
  infrastructure_error: boolean;
  model_receipts: Array<{ provider: string; model: string }>;
}
