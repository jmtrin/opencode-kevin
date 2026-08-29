import type { McpIdentity } from "./identity.js";

export interface Provenance {
  repo_id: string;
  identity_source: string;
  channel: "mcp";
  confidence?: number;
  evidence_count?: number;
}

export function buildProvenance(identity: McpIdentity, extra?: Partial<Provenance>): Provenance {
  return {
    repo_id: identity.repoId,
    identity_source: identity.source,
    channel: "mcp",
    ...extra,
  };
}
