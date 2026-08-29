// @jmtrin/kevin-core public entry — Bedrock (K13-002)
// Explicit re-export list defines future C-10 surface; keep minimal and deliberate.
export * from "./Store.js";
export * from "./Migrate.js";
// MemoryService has duplicate hasRepoIdColumn with columns.ts — export selectively (keep MemoryService's hasRepoIdColumn, columns provides other helpers)
export { MemoryService, DATE_NOW, mapRow, readOriginCallId, countSupersedeCandidates, hasRepoIdColumn } from "./MemoryService.js";
export type { Memory, SlimMemory, SlimMemoryWithEvidence, SaveInput, QueryInput, GetRelevantInput, MemoryType, MemoryScope, MemoryOrigin, MemoryUpdateResult } from "./MemoryService.js";
export * from "./ToolCallObserver.js";
export * from "./Reflector.js";
export * from "./ContextInjector.js";
export * from "./QualityGate.js";
export * from "./InjectionLedger.js";
export * from "./Curator.js";
export * from "./ArtifactWriter.js";
export * from "./SharedLayer.js";
export * from "./RepoIdentity.js";
export * from "./RepoTruth.js";
export * from "./ConflictDetector.js";
export * from "./CausalChain.js";
export * from "./PatternMiner.js";
export * from "./ConventionMiner.js";
export * from "./Feedback.js";
export * from "./Archiver.js";
export * from "./Retrospective.js";
export * from "./Materializer.js";
export * from "./HookLiveness.js";
export * from "./perf.js";
export * from "./metrics.js";
export * from "./okf.js";
export * from "./okf-export.js";
export * from "./okf-import.js";
export * from "./LessonFixer.js";
export * from "./contract.js";
export * from "./confidence.js";
export * from "./diff.js";
export * from "./escape.js";
export * from "./fingerprint.js";
export * from "./inferability.js";
export * from "./query-tokenizer.js";
export * from "./memory-format.js";
export * from "./redact.js";
export * from "./uuid.js";
export * from "./sqlite-adapter.js";
// columns has duplicate hasRepoIdColumn with MemoryService — export without that function (MemoryService's version is canonical via index)
export { hasColumn, hasIgnoredColumn, hasCuratedColumn, hasTruthColumns, hasLayerColumn, hasRecurrenceColumn, hasArchivedColumn, hasFeedbackColumns, hasFeedbackTable } from "./columns.js";
export * from "./time-ms.js";
export * from "./idle-pipeline.js";
export * from "./replay.js";
export * from "./replay-types.js";
export * from "./ChatBridge.js";
export * from "./DashboardHtml.js";
// TuiActions duplicates proposalToken with DashboardHtml — export selectively (exclude proposalToken)
export { deleteMailbox, processActions, readMailbox, writeResults, verifyFresh, consumeMailbox } from "./TuiActions.js";
export type { MailboxReadResult, PendingProposal, ProcessDeps, ActionStatus } from "./TuiActions.js";
export * from "./TuiSnapshots.js";
// tui view types — shared between core snapshots and tui package (K13-004)
export type { ProposalView, ConflictView, HealthView, TuiSnapshotSet, TuiAction, ActionResult } from "./tui-types.js";
// shims for isolation
export * from "./capabilities.js";
export * from "./host.js";
export { V2_SPECIFIER } from "./native.js";
export type { NativeDeps, NativeRegistration, SettingsReader } from "./native.js";
// kevin_* handlers — avoid duplicate EmissionState / NativeDeps
export * from "./kevin_approve.js";
export { buildAudit, type AuditReport, type ChannelReport, type CurationReport, type TruthReport, type EmissionState } from "./kevin_audit.js";
export * from "./kevin_bench.js";
export * from "./kevin_conflicts.js";
export * from "./kevin_contract.js";
export * from "./kevin_doctor.js";
export * from "./kevin_facts.js";
export * from "./kevin_forget.js";
export { handleNative } from "./kevin_native.js";
export * from "./kevin_propose.js";
export { kevinPublish } from "./kevin_publish.js";
export type { PublishResult } from "./kevin_publish.js";
export * from "./kevin_why.js";

// KEVIN_CONFIG_KEYS and related constants — moved from adapter index so core owns the source of truth (C-04).
// Duplicated here to allow adapter to import from core; adapter will re-export them.
export * from "./env.js";
export const KEVIN_CONFIG_KEYS = [
	"quality_gate_enabled",
	"lesson_snippet_injection",
	"patternminer_enabled",
	"cross_project_enabled",
	"llm_reflection_enabled",
	"tool_calls_dedup_enabled",
	"deterministic_retrieval",
	"pre_prompt_budget_tokens",
	"archive_after_days",
	"curation_enabled",
	"agents_md_path",
	"skill_emission_enabled",
	"reference_emission_enabled",
	"injection_confidence_floor",
	"repo_truth_enabled",
	"convention_mining_enabled",
	"conflict_detection_enabled",
	"error_lesson_mode",
	"shared_layer_enabled",
	"okf_path",
	"share_requires_approval",
	"author_identity_mode",
	"shared_confidence_floor",
	"hook_liveness_enabled",
	"native_registration_enabled",
	"host_probe_history_enabled",
	"dead_hook_report_threshold",
	"perf_enabled",
	"perf_ring_capacity",
	"perf_flush_on_idle",
	"contract_report_enabled",
	"tui_snapshots_enabled",
] as const;
export const ERROR_LESSON_MODE_VALUES = ["all", "triage_only"] as const;
export const KEVIN_VERSION = "1.3.0";
