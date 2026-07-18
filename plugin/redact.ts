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

const PRIVATE_BLOCK_RE = /<private\b[^>]*>([\s\S]*?)<\/private>/gi;

export function stripPrivate(text: string): string {
	return text.replace(PRIVATE_BLOCK_RE, (_match, inner: string) => {
		const n = inner.length;
		return `<private: redacted ${n} chars>`;
	});
}
