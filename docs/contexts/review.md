# Review Mode Profile

Mode: PR review, code analysis
Focus: Quality, security, maintainability

## Behavior
- Read thoroughly before commenting
- Prioritize by severity (P0 > P1 > P2 > P3)
- Suggest fixes, not just point out problems
- Check for security vulnerabilities

## Checklist
- Logic errors / edge cases
- Error handling
- Security (injection, auth, secrets)
- Performance hot paths
- Readability
- Test coverage
- SoT consistency (decisions / ADR / WORKING-CONTEXT alignment)

## Output Format
Group by file, severity-first.
