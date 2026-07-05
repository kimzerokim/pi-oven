/**
 * Vendored from upstream OMC team runtime surfaces.
 * Source: /Users/kimzerokim/.claude/plugins/marketplaces/omc/src/team/types.ts
 * Upstream commit: 50f6ff05eb5d9ebed66f05d8c4580c0b119f37af
 */

export const PI_OVEN_NATIVE_MAX_WORKERS = 100;

export type TeamTaskStatus = "pending" | "in_progress" | "completed" | "failed";
export type WorktreeMode = "disabled" | "detached" | "named";
export type TeamRuntimeLaneId = "survey" | "research" | "comparison" | "verification" | "documentation" | "owned_write";
export type TeamRuntimeSharedStatePolicy = "read_only" | "exclusive_write";
export type TeamRuntimeOutputSchemaId =
  | "survey_report"
  | "research_brief"
  | "comparison_matrix"
  | "verification_report"
  | "documentation_patch"
  | "owned_write_result";
export type TeamRuntimeReducerId = "append_results" | "merge_comparison" | "apply_document_patch" | "owned_write_commit";
export type TeamPersistenceSurfaceId =
  | "team_config"
  | "startup_failure_sidecar"
  | "task_file"
  | "task_failure_sidecar"
  | "worker_dir"
  | "worker_inbox"
  | "worker_ready_marker"
  | "worker_overlay"
  | "worker_mailbox"
  | "team_manifest";

export interface TeamRuntimePersistenceClaim {
  surface: TeamPersistenceSurfaceId;
  key?: string;
}

export interface TeamRuntimeLaneMetadata {
  kind: TeamRuntimeLaneId;
  objective: string;
  independence_reason: string;
  shared_state_policy: TeamRuntimeSharedStatePolicy;
  output_schema: TeamRuntimeOutputSchemaId;
  reducer: TeamRuntimeReducerId;
  persistence_claims?: TeamRuntimePersistenceClaim[];
}

export interface TaskFileMetadata extends Record<string, unknown> {
  lane?: TeamRuntimeLaneMetadata;
}

export interface TaskFile {
  id: string;
  subject: string;
  description: string;
  status: TeamTaskStatus;
  owner: string;
  blocks: string[];
  blockedBy: string[];
  metadata?: TaskFileMetadata;
  claimedBy?: string;
  claimedAt?: number;
  claimPid?: number;
}

export type TaskFileUpdate = Partial<
  Pick<TaskFile, "status" | "owner" | "metadata" | "claimedBy" | "claimedAt" | "claimPid">
>;

export interface TaskFailureSidecar {
  taskId: string;
  lastError: string;
  retryCount: number;
  lastFailedAt: string;
}

export interface TeamTaskInput {
  subject: string;
  description: string;
  owner?: string;
  blocked_by?: string[];
  role?: string;
  lane?: TeamRuntimeLaneMetadata;
}

export interface WorkerInfo {
  name: string;
  index: number;
  role: string;
  assigned_tasks: string[];
  pane_id?: string;
  working_dir?: string;
  worktree_path?: string;
  worktree_created?: boolean;
  worker_cli?: string;
  output_file?: string;
}

export interface TeamConfig {
  name: string;
  task: string;
  agent_type: string;
  worker_launch_mode: "interactive";
  worker_count: number;
  max_workers: number;
  workers: WorkerInfo[];
  created_at: string;
  tmux_session: string;
  tmux_window_owned?: boolean;
  next_task_id: number;
  leader_cwd?: string;
  team_state_root?: string;
  leader_pane_id: string | null;
  hud_pane_id: string | null;
  resize_hook_name: string | null;
  resize_hook_target: string | null;
  next_worker_index?: number;
  worktree_mode?: WorktreeMode;
}

export interface StartupDispatchRequest {
  teamName: string;
  workerName: string;
  workerIndex: number;
  paneId: string;
  taskId: string;
  task: TeamTaskInput;
  cwd: string;
  sessionName: string;
}

export interface StartupDispatchResult {
  ok: boolean;
  reason?: string;
  outputFile?: string;
}

export interface WorkerLaunchContext {
  teamName: string;
  workerName: string;
  workerIndex: number;
  cwd: string;
  taskId: string;
  task: TeamTaskInput;
  worktreePath?: string;
}

export interface WorkerStartSpec {
  command: string;
  envVars?: Record<string, string>;
}

export interface SpawnWorkerResult {
  paneId: string | null;
  startupAssigned: boolean;
  startupFailureReason?: string;
  outputFile?: string;
}

export interface StartedWorkerRecord {
  workerName: string;
  paneId?: string;
  worktreePath?: string;
  worktreeCreated?: boolean;
  taskId?: string;
}

export interface TeamRuntimeHandle {
  teamName: string;
  sessionName: string;
  leaderPaneId: string | null;
  workerPaneIds: string[];
  config: TeamConfig;
}

export interface CreateTeamSessionResult {
  sessionName: string;
  leaderPaneId: string;
  workerPaneIds: string[];
}

export interface TeamTmuxController {
  createTeamSession(teamName: string, workerCount: number, cwd: string, options?: { newWindow?: boolean }): Promise<CreateTeamSessionResult>;
  splitWorkerPane(splitTarget: string, direction: "right" | "down", cwd: string): Promise<string | null>;
  spawnWorkerInPane(paneId: string, spec: { teamName: string; workerName: string; command: string; envVars?: Record<string, string> }): Promise<void>;
  capturePane(paneId: string): Promise<string>;
  sendPaneKey(paneId: string, key: string): Promise<void>;
  killPane(paneId: string): Promise<void>;
  killSession(sessionName: string, workerPaneIds?: string[], leaderPaneId?: string | null): Promise<void>;
}

export interface EnsureWorkerWorktreeOptions {
  mode?: WorktreeMode;
}

export interface EnsureWorkerWorktreeResult {
  path: string;
  created: boolean;
}

export interface CleanupTeamWorktreesResult {
  removed: string[];
  preserved: string[];
}

export interface WorktreeCleanupSafety {
  hasEvidence: boolean;
}

export interface TeamWorktreeManager {
  ensureWorkerWorktree(teamName: string, workerName: string, repoRoot: string, options?: EnsureWorkerWorktreeOptions): Promise<EnsureWorkerWorktreeResult | null> | EnsureWorkerWorktreeResult | null;
  removeWorkerWorktree(teamName: string, workerName: string, repoRoot: string): Promise<void> | void;
  inspectTeamWorktreeCleanupSafety(teamName: string, repoRoot: string): Promise<WorktreeCleanupSafety> | WorktreeCleanupSafety;
  cleanupTeamWorktrees(teamName: string, repoRoot: string): Promise<CleanupTeamWorktreesResult> | CleanupTeamWorktreesResult;
}

export interface StartTeamV2Options {
  teamName: string;
  workerCount: number;
  agentType: string;
  tasks: TeamTaskInput[];
  cwd: string;
  tmux: TeamTmuxController;
  buildWorkerStart: (context: WorkerLaunchContext) => WorkerStartSpec | Promise<WorkerStartSpec>;
  dispatchStartup: (request: StartupDispatchRequest) => StartupDispatchResult | Promise<StartupDispatchResult>;
  worktrees?: TeamWorktreeManager;
  maxWorkers?: number;
  newWindow?: boolean;
  worktreeMode?: WorktreeMode;
}

export interface ScaleUpResult {
  ok: true;
  newWorkerCount: number;
  nextWorkerIndex: number;
  addedWorkers: string[];
}

export interface ScaleError {
  ok: false;
  error: string;
}

export interface ScaleUpOptions {
  teamName: string;
  count: number;
  agentType: string;
  tasks: TeamTaskInput[];
  cwd: string;
  tmux: TeamTmuxController;
  buildWorkerStart: (context: WorkerLaunchContext) => WorkerStartSpec | Promise<WorkerStartSpec>;
  dispatchStartup: (request: StartupDispatchRequest) => StartupDispatchResult | Promise<StartupDispatchResult>;
  maxWorkers?: number;
  worktrees?: TeamWorktreeManager;
}
