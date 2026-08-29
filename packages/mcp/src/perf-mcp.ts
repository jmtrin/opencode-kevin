// K14-015 perf scopes — reuse core Perf ring
import { BUDGETS } from "@jmtrin/kevin-core";
export const MCP_BUDGETS = BUDGETS.filter((b) => b.scope.startsWith("mcp."));
export { BUDGETS };
