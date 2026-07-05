# State-of-the-Art Harness + Loop Engineering Patterns for pi-oven

## Scope
- Date: 2026-07-04
- Strategic context: current fixed choice is `pi-oven-first 재설계`.
- Topic: agentic harness engineering and loop engineering patterns relevant to pi-oven.
- Non-goals: generic AI commentary, uncited claims, and new architecture decisions beyond what the cited sources support.

## Executive summary

### Observation
Five evidence-backed themes repeat across current harness docs and recent research: independence-gated parallelism, hard loop controls, structured requirements elicitation, agent-centric debug/tool interfaces, and protocolized extension boundaries.

### Evidence
- Anthropic reports that its orchestrator-worker research system outperformed single-agent Claude Opus 4 by **90.2%** on an internal research evaluation, but also used about **15×** more tokens than chat and cautions that many coding tasks have fewer truly parallelizable subtasks. URL: https://www.anthropic.com/engineering/multi-agent-research-system
- Claude Code best-practices docs recommend runnable verification, `/goal`, Stop hooks, fresh verification subagents, and interview-first planning for larger features. URL: https://code.claude.com/docs/en/best-practices
- MCP client concepts expose structured elicitation and explicitly state that roots communicate scope but do not enforce security. URL: https://modelcontextprotocol.io/docs/learn/client-concepts
- OpenAI Agents SDK documents deterministic code-owned orchestration, `max_turns`, blocking versus parallel guardrails, and tool namespaces/search. URLs: https://openai.github.io/openai-agents-python/multi_agent/ , https://openai.github.io/openai-agents-python/running_agents/ , https://openai.github.io/openai-agents-python/guardrails/ , https://openai.github.io/openai-agents-python/tools/
- Recent software-engineering papers report measurable gains from interaction on underspecified tasks, ontology-guided elicitation, debugger integration, and function-level dynamic analysis. URLs: https://arxiv.org/abs/2502.13069 , https://arxiv.org/abs/2605.05828 , https://arxiv.org/abs/2602.18571 , https://arxiv.org/abs/2604.24212

### Implications for pi-oven
1. Use parallel workers only when branch independence is explicit.
2. Treat autonomous loops as finite-state systems with hard exit gates.
3. Treat deep interview / ask-first as a first-class runtime capability.
4. Prefer structured, high-level debug/code-intelligence tools over raw transcripts.
5. Keep safety and capability boundaries in runtime hooks, manifests, and permissions rather than prompt-only policy.

## Evidence base

### Official / primary sources consulted
1. Anthropic, **How we built our multi-agent research system** (2025-06-13). URL: https://www.anthropic.com/engineering/multi-agent-research-system
2. Claude Code, **Best practices** (2026 docs). URL: https://code.claude.com/docs/en/best-practices
3. Claude Code, **How Claude Code works** (2026 docs). URL: https://code.claude.com/docs/en/how-claude-code-works
4. Claude Code, **Features overview** (2026 docs). URL: https://code.claude.com/docs/en/features-overview
5. Claude Code, **Hooks** (2026 docs). URL: https://code.claude.com/docs/en/hooks
6. Claude Code, **Plugins** (2026 docs). URL: https://code.claude.com/docs/en/plugins
7. Model Context Protocol, **Architecture** (2025/2026 docs). URL: https://modelcontextprotocol.io/docs/learn/architecture
8. Model Context Protocol, **Client concepts** (2025/2026 docs). URL: https://modelcontextprotocol.io/docs/learn/client-concepts
9. Google ADK, **ParallelAgent** (2026 docs). URL: https://adk.dev/agents/workflow-agents/parallel-agents/
10. OpenAI Agents SDK, **Multi-agent orchestration** (2026 docs). URL: https://openai.github.io/openai-agents-python/multi_agent/
11. OpenAI Agents SDK, **Running agents** (2026 docs). URL: https://openai.github.io/openai-agents-python/running_agents/
12. OpenAI Agents SDK, **Guardrails** (2026 docs). URL: https://openai.github.io/openai-agents-python/guardrails/
13. OpenAI Agents SDK, **Tools** (2026 docs). URL: https://openai.github.io/openai-agents-python/tools/
14. OpenAI Agents SDK, **Context management** (2026 docs). URL: https://openai.github.io/openai-agents-python/context/
15. GitHub Docs, **About Copilot coding agent** (2026 docs). URL: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
16. LangGraph, **Graph API overview** (2026 docs). URL: https://docs.langchain.com/oss/python/langgraph/graph-api

### Academic / research sources consulted
1. Yang et al., **SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering** (2024). URL: https://arxiv.org/abs/2405.15793
2. Wu et al., **AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation** (2023). URL: https://arxiv.org/abs/2308.08155
3. Vijayvargiya et al., **Ambig-SWE: Interactive Agents to Overcome Underspecificity in Software Engineering** (2025 / ICLR 2026). URL: https://arxiv.org/abs/2502.13069
4. KC et al., **Demystifying Feature Requests** (2025 / IEEE RE 2025). URL: https://arxiv.org/abs/2507.13555
5. Fang et al., **ClarifyCodeBench** (2026). URL: https://arxiv.org/abs/2607.00711
6. Jin et al., **From Chat to Interview: Agentic Requirements Elicitation with an Experience Ontology** (2026 / RE 2026). URL: https://arxiv.org/abs/2605.05828
7. Kuang et al., **REAgent: Requirement-Driven LLM Agents for Software Issue Resolution** (2026). URL: https://arxiv.org/abs/2604.06861
8. Garg & Huang, **Debug2Fix: Can Interactive Debugging Help Coding Agents Fix More Bugs?** (2026). URL: https://arxiv.org/abs/2602.18571
9. Xiang et al., **Empowering Autonomous Debugging Agents with Efficient Dynamic Analysis** (2026 / FSE 2026). URL: https://arxiv.org/abs/2604.24212
10. Hutter & Pradel, **AgentStepper: Interactive Debugging of Software Development Agents** (2026). URL: https://arxiv.org/abs/2602.06593

## Findings by topic

## 1. Parallel orchestration

### Observation
Parallel multi-agent work is effective for independent branches, but the strongest sources do not support unconditional fan-out for tightly coupled coding work.

### Evidence
- Anthropic describes an orchestrator-worker pattern, reports a **90.2%** internal research-eval gain, and also reports roughly **15×** chat-token cost plus a warning that many coding tasks are less parallelizable. URL: https://www.anthropic.com/engineering/multi-agent-research-system
- Google ADK says `ParallelAgent` executes sub-agents concurrently, with no automatic shared history/state and non-deterministic result ordering. URL: https://adk.dev/agents/workflow-agents/parallel-agents/
- OpenAI Agents SDK recommends code-owned orchestration and parallel execution with `asyncio.gather` when tasks do not depend on each other. URL: https://openai.github.io/openai-agents-python/multi_agent/
- LangGraph frames graph execution as parallel super-steps with explicit reducer semantics and a clear halt rule when all nodes are inactive and no messages remain in transit. URL: https://docs.langchain.com/oss/python/langgraph/graph-api

### Implications for pi-oven
- Adopt a scheduler/reducer model in runtime code.
- Require branch contracts with `objective`, `independence_reason`, `shared_state_policy`, `output_schema`, and `reducer`.
- Reject silent mutable-state sharing across workers.
- [INFERENCE] pi-oven’s current worker redesign should treat graph-style reducers as a better target than ad-hoc merge lore because both ADK and LangGraph make shared-state semantics explicit.

## 2. Loop control and halt conditions

### Observation
Current production harness guidance converges on explicit limits, checkpoints, verification gates, and side-effect-aware guardrails.

### Evidence
- Claude Code recommends runnable checks, `/goal`, Stop hooks, and fresh verification subagents; Stop-hook enforcement is overridden after **8 consecutive blocks**. URL: https://code.claude.com/docs/en/best-practices
- OpenAI Agents SDK raises `MaxTurnsExceeded` when `max_turns` is exceeded. URL: https://openai.github.io/openai-agents-python/running_agents/
- GitHub Copilot cloud agent uses an ephemeral environment and a hard **59-minute** max session. URL: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- Anthropic stresses durable execution, retry logic, checkpoints, resumability, and tracing for long-running agents. URL: https://www.anthropic.com/engineering/multi-agent-research-system
- OpenAI guardrails docs distinguish blocking guardrails from parallel guardrails and note that parallel tripwires may allow token/tool consumption before cancellation. URL: https://openai.github.io/openai-agents-python/guardrails/

### Implications for pi-oven
- Model autonomous modes as finite-state loops with explicit machine-readable exit gates.
- Use blocking gates for destructive/external/code-write paths.
- Add explicit halt taxonomy: `max_turns`, `max_wall_time`, `verification_failed`, `subagent_stuck`, `unsafe_external_action`, `repeated_guardrail_tripwire`, `repeated_tool_failure`.
- Reject model-only “looks done” stopping.

## 3. Interactive requirements clarification / deep interview

### Observation
The evidence strongly favors bounded clarification before implementing ambiguous or high-impact work, and also shows that strong code generation does not automatically imply strong clarification behavior.

### Evidence
- Claude Code recommends interview-first planning for larger features. URL: https://code.claude.com/docs/en/best-practices
- MCP elicitation supports schema-based structured user input, decline, and cancel semantics. URL: https://modelcontextprotocol.io/docs/learn/client-concepts
- Ambig-SWE reports up to **74%** improvement from interaction on underspecified tasks and finds that models struggle to distinguish underspecified from well-specified prompts. URL: https://arxiv.org/abs/2502.13069
- ClarifyCodeBench reports that coding performance does not inherently transfer to clarification performance and that ambiguity density degrades results. URL: https://arxiv.org/abs/2607.00711
- OntoAgent reports ontology-guided interviews improved elicitation effectiveness by **33%** and turn-discounted key-question rate by **21%**. URL: https://arxiv.org/abs/2605.05828
- REAgent reports that structured requirement refinement improved resolved issues by **17.40%** in its evaluation setting. URL: https://arxiv.org/abs/2604.06861

### Implications for pi-oven
- Promote ask-first / deep-interview flows from prompt style to runtime primitive.
- Record decisions as structured artifacts with scope, non-goals, verification plan, and approval state.
- Use concern categories such as scope, risk, permissions, branch/PR mode, verification, and rollback.
- [INFERENCE] The current fixed strategy `pi-oven-first 재설계` is consistent with the evidence because the sources support native clarification primitives rather than imported prompt wrappers.

## 4. Native debugger and code-intelligence leverage

### Observation
Tool/interface design matters directly for coding-agent performance, but recent papers argue against raw line-by-line debugger transcripts as the default interaction model.

### Evidence
- SWE-agent attributes gains to its Agent-Computer Interface and reports pass@1 improvements on SWE-bench and HumanEvalFix. URL: https://arxiv.org/abs/2405.15793
- Debug2Fix reports >20% improvement for certain models after debugger integration and argues tool design can rival model upgrades. URL: https://arxiv.org/abs/2602.18571
- ADI argues that raw line-level debugger interaction is cost-inefficient and proposes function-level Frame Lifetime Trace; it reports solving **63.8%** of SWE-bench Verified in its setting and improving existing agents by **6.2%–18.5%**. URL: https://arxiv.org/abs/2604.24212
- AgentStepper shows value in trajectory-level debugging with breakpoints, stepwise execution, live prompt/tool editing, and repository-level code-change views. URL: https://arxiv.org/abs/2602.06593
- Claude Code’s docs describe code intelligence as definitions, references, and type errors for typed-language workflows. URLs: https://code.claude.com/docs/en/how-claude-code-works , https://code.claude.com/docs/en/features-overview

### Implications for pi-oven
- Prefer high-level primitives such as `trace_function`, `summarize_failure_path`, `set_breakpoint_at_symbol`, `list_changed_runtime_state`, and `validate_patch_against_trace`.
- Prefer symbol/callsite/code-graph views before broad file reads when the tooling exists.
- Reject raw debugger transcript loops as the default interface.

## 5. Plugin boundaries, hooks, and capability isolation

### Observation
The most consistent official guidance separates workflow knowledge, isolated execution, deterministic enforcement, and external capability access into distinct layers.

### Evidence
- MCP defines host/client/server separation and capability negotiation. URL: https://modelcontextprotocol.io/docs/learn/architecture
- MCP client concepts state that roots communicate intended boundaries but **do not enforce security restrictions**. URL: https://modelcontextprotocol.io/docs/learn/client-concepts
- Claude Code distinguishes CLAUDE.md, skills, subagents, hooks, plugins, MCP, code intelligence, and teams by role and context cost. URL: https://code.claude.com/docs/en/features-overview
- Claude Code plugins package skills, agents, hooks, MCP servers, LSP servers, monitors, bin executables, and settings with namespaced skills. URL: https://code.claude.com/docs/en/plugins
- Claude Code hooks can deny unsafe tool calls at lifecycle events such as `PreToolUse`, `Stop`, and `Elicitation`. URL: https://code.claude.com/docs/en/hooks
- OpenAI recommends namespaces and deferred tool-surface loading for larger tool collections. URL: https://openai.github.io/openai-agents-python/tools/

### Implications for pi-oven
- Keep core orchestration small and protocol-like.
- Put irreversible safety controls in hooks/gates/permissions, not prompt prose.
- Namespace plugin capabilities and defer heavy tool surfaces until needed.
- Reject using roots or prompt rules as the primary security boundary.

## Contradictions and caveats

### Observation
The sources align on direction, but several trade-offs matter enough to keep visible in the planning artifacts.

### Evidence
1. Parallel agents improve breadth-first research, but Anthropic’s own writeup shows high token cost and weaker applicability to tightly coupled coding. URL: https://www.anthropic.com/engineering/multi-agent-research-system
2. Debugger integration helps, but ADI warns that low-level stepwise debugger UX is the wrong abstraction for LLM agents. URLs: https://arxiv.org/abs/2602.18571 , https://arxiv.org/abs/2604.24212
3. Clarification improves outcomes, but ClarifyCodeBench shows that clarification quality is its own capability, not a free byproduct of coding strength. URL: https://arxiv.org/abs/2607.00711
4. Guardrails can run in parallel for latency, but OpenAI notes that side effects may already occur before cancellation unless the guardrail is blocking. URL: https://openai.github.io/openai-agents-python/guardrails/
5. MCP roots help scope, but MCP explicitly says they are not a security boundary. URL: https://modelcontextprotocol.io/docs/learn/client-concepts

### Risks for pi-oven planning
- Over-generalizing multi-agent gains from research search tasks to code-edit workflows.
- Adding debugger access without designing the right abstraction layer.
- Treating interview prompts as sufficient without a structured question/state system.
- Using prompt rules as if they were enforcement.

## Recommendations table

| Rank | Recommendation | Status | Evidence | Direct pi-oven implication |
| --- | --- | --- | --- | --- |
| 1 | Deterministic, independence-gated parallel orchestration | Adopt / Adapt | Anthropic, ADK, OpenAI, LangGraph | Keep main agent as scheduler/reducer; use isolated workers only for independent lanes. |
| 2 | Hard loop-control primitives with fresh verification | Adopt | Claude Code, OpenAI, GitHub, Anthropic | Finite-state autonomous loops with caps, checkpoints, stuck thresholds, and fresh-verifier completion. |
| 3 | Structured ambiguity-triggered deep interview | Adopt | Claude Code, MCP, Ambig-SWE, ClarifyCodeBench, OntoAgent, REAgent | First-class ask/spec workflow before ambiguous execution. |
| 4 | Agent-centric debugger and code-intelligence interfaces | Adopt / Adapt | SWE-agent, Debug2Fix, ADI, AgentStepper, Claude Code | High-level trace/symbol/callsite tools instead of raw debugger loops. |
| 5 | Protocolized plugin boundaries and deterministic hooks | Adopt | MCP, Claude Code, OpenAI | Manifested capabilities, namespaced skills, deferred tool schemas, hook-enforced safety. |

## Open questions / evidence gaps
- Exact pi-oven thresholds for fan-out, wall-clock caps, and max turns remain local-design questions; the cited sources justify the existence of caps, not pi-oven-specific numbers.
- Exact transfer sizes from the 2026 debugger and requirements papers remain benchmark-specific; treat them as method evidence rather than guaranteed pi-oven gains.
- [INFERENCE] MCP durable-task/task-spec details may need a follow-up refresh before pi-oven designs directly against them, because the architecture/client-concepts docs were sufficient for this memo but not a full task-schema implementation contract.

## Confidence
- Overall recommendation confidence: high.
- Numeric effect-size transfer confidence: medium.
- Reason: the major directions are supported by multiple independent official and research sources, while the exact thresholds and effect sizes still need local pi-oven evaluation.
