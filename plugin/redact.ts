const PATH_PATTERNS: RegExp[] = [
	/[a-z]:\\[^\s"'<>|*?:]+/gi,
	/\/(?:home|users|var|tmp|opt|etc|root|usr|app|work|workspace|code|repo|project|src|build|dist|packages|services|api|web|client|server|lib|node_modules)(?:\/[^\s"'<>|*?:]+)*/gi,
];

export function redactPaths(text: string): string {
	let out = text;
	for (const pat of PATH_PATTERNS) {
		out = out.replace(pat, "<path>");
	}
	return out;
}
