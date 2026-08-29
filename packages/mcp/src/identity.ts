import { resolve as resolveRepoIdentity } from "@jmtrin/kevin-core";
import type { Store } from "@jmtrin/kevin-core";
import type { KevinEnv } from "@jmtrin/kevin-core";
import type { HostSurface } from "@jmtrin/kevin-core";

const DECLARED_ID_RE = /^[0-9a-f]{16}$/;

export type IdentitySourceMcp = "declared" | "override" | "remote" | "host" | "path";

export interface McpIdentity {
  repoId: string;
  source: IdentitySourceMcp;
  evidence: string;
  resolved: string; // the repoId that RepoIdentity would have given (for mismatch guard transparency)
  requested?: string; // the declared/override id when mismatch
}

export function validateDeclaredId(id: string): boolean {
  return DECLARED_ID_RE.test(id);
}

/**
 * Resolve MCP effective identity per plan §4.1 (D14-02):
 *   1. CLI/env KEVIN_REPO (declared hex-16) — validated, else throws at boot
 *   2. setting mcp_repo_override (non-empty)
 *   3. RepoIdentity.resolve(projectRoot)
 *
 * The `kevinRepo` param is the raw KEVIN_REPO env/CLI value (if any).
 * `settingOverride` is the DB value of `mcp_repo_override` (if any).
 */
export function resolveMcpIdentity(opts: {
  kevinRepo?: string | null;
  settingOverride?: string | null;
  projectRoot: string;
  host?: HostSurface;
}): McpIdentity {
  const resolvedBase = resolveRepoIdentity(opts.projectRoot, opts.host);
  const resolved = resolvedBase.repoId;

  // 1. KEVIN_REPO env/CLI declared
  if (opts.kevinRepo !== undefined && opts.kevinRepo !== null && opts.kevinRepo !== "") {
    const v = opts.kevinRepo.trim();
    if (!validateDeclaredId(v)) {
      throw new Error(`KEVIN_REPO must be 16 lowercase hex characters (got "${v}")`);
    }
    return {
      repoId: v,
      source: "declared",
      evidence: "env:KEVIN_REPO",
      resolved,
      requested: v,
    };
  }

  // 2. setting override non-empty
  if (opts.settingOverride !== undefined && opts.settingOverride !== null && opts.settingOverride.trim() !== "") {
    const v = opts.settingOverride.trim();
    if (!validateDeclaredId(v)) {
      throw new Error(`mcp_repo_override must be 16 lowercase hex characters (got "${v}")`);
    }
    return {
      repoId: v,
      source: "override",
      evidence: "setting:mcp_repo_override",
      resolved,
      requested: v,
    };
  }

  // 3. RepoIdentity
  return {
    repoId: resolved,
    source: resolvedBase.source as IdentitySourceMcp,
    evidence: resolvedBase.evidence,
    resolved,
  };
}

/**
 * Load setting mcp_repo_override from store (lazy: absent => null).
 */
export function readSettingOverride(store: Store): string | null {
  try {
    const row = store.prepare("SELECT value FROM kevin_settings WHERE key = ?").get("mcp_repo_override") as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Guard for repo-scoped tools per plan §4.1:
 * When caller passes an explicit repo scope that ≠ effective id → refuse.
 * Only `status` bypasses (reports both). Reads are refused too.
 */
export function assertScope(
  effectiveId: string,
  requestedRepoId?: string | null,
): { error: "repo_mismatch"; requested: string; resolved: string } | null {
  if (requestedRepoId === undefined || requestedRepoId === null || requestedRepoId === "") return null;
  if (requestedRepoId === effectiveId) return null;
  return { error: "repo_mismatch", requested: requestedRepoId, resolved: effectiveId };
}

/**
 * Convenience: resolve from live store + env.
 * Reads KEVIN_REPO from process.env and setting from store.
 */
export function resolveMcpIdentityLive(store: Store, env: KevinEnv, host?: HostSurface): McpIdentity {
  const kevinRepo = process.env.KEVIN_REPO ?? null;
  const settingOverride = readSettingOverride(store);
  return resolveMcpIdentity({ kevinRepo, settingOverride, projectRoot: env.projectRoot, host });
}
