# Recommendation Format

Every recommendation must use this field order and labels:

1. Recommendation ID
2. Priority
3. Action
4. Rationale
5. Supporting evidence
6. Trade-offs
7. Next validation step

## Value rules

- Recommendation ID: `REC-<2 digit number>`.
- Priority: `High`, `Medium`, or `Low` only.
- Supporting evidence: one or more citations mapped to findings.
- Trade-offs: at least one downside or cost.
- Next validation step: concrete verification action.

## Example

- Recommendation ID: REC-01
- Priority: High
- Action: Consolidate duplicate auth token refresh checks into a shared module.
- Rationale: Removes diverging logic paths and reduces expiry drift risk.
- Supporting evidence: [F2], [F5], RFC-6749 section references.
- Trade-offs: Migration touches three call sites and requires staged rollout.
- Next validation step: Run token-expiry integration tests with skewed clock fixtures.
