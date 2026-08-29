// KevinEnv — injected environment (K13-005, D13-03).
// Defaults exist for standalone/test use while HOSTS inject explicitly.
// resolveEnv performs NO filesystem access; it only resolves defaults
// from process state (cwd/homedir).

import { homedir } from "node:os";
import { join } from "node:path";

export interface KevinEnv {
	projectRoot: string;
	dataRoot: string;
}

export function resolveEnv(partial?: Partial<KevinEnv>): KevinEnv {
	return {
		projectRoot: partial?.projectRoot ?? process.cwd(),
		dataRoot: partial?.dataRoot ?? join(homedir(), ".opencode-kevin"),
	};
}
