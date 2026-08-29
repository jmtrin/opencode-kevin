// @jmtrin/opencode-kevin-tui — target-exclusive TUI package (K13-004)
// Re-exports the TUI module and its view types; the host imports this package directly.
// The main plugin's exports["./tui"] redirects to this package (bare specifier) so
// external consumers see no change via `import "@jmtrin/opencode-kevin/tui"`.
export * from "./tui.js";
export * from "./tui-types.js";
export { tui as default } from "./tui.js";
