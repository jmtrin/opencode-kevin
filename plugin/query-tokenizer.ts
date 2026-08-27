/**
 * K4-013 — shared FTS5 query tokenizer.
 *
 * Injection recall ORs the quoted tokens (`"t1" OR "t2"`) while
 * `kevin_why` ANDs them (`"t1" AND "t2"`).
 */

// v1.1.0 (K11-012 / plan §5.5, D11-05) — single source for STOP_WORDS (union of three lists)
export const STOP_WORDS = new Set<string>([
	"a",
	"about",
	"after",
	"again",
	"all",
	"also",
	"an",
	"and",
	"any",
	"are",
	"as",
	"at",
	"be",
	"been",
	"before",
	"being",
	"but",
	"by",
	"can",
	"como",
	"con",
	"could",
	"de",
	"did",
	"do",
	"does",
	"el",
	"en",
	"eso",
	"for",
	"from",
	"had",
	"has",
	"have",
	"he",
	"her",
	"his",
	"how",
	"i",
	"if",
	"in",
	"into",
	"is",
	"it",
	"its",
	"la",
	"las",
	"los",
	"may",
	"mi",
	"might",
	"more",
	"most",
	"must",
	"my",
	"not",
	"o",
	"of",
	"on",
	"one",
	"or",
	"our",
	"para",
	"per",
	"por",
	"que",
	"shall",
	"she",
	"sin",
	"so",
	"su",
	"than",
	"that",
	"the",
	"their",
	"them",
	"then",
	"there",
	"these",
	"they",
	"this",
	"those",
	"through",
	"to",
	"too",
	"tu",
	"un",
	"una",
	"under",
	"up",
	"us",
	"via",
	"was",
	"we",
	"were",
	"what",
	"when",
	"where",
	"which",
	"while",
	"who",
	"why",
	"will",
	"with",
	"would",
	"y",
	"you",
	"your",
]);

/** Lowercase, split on whitespace, drop stopwords. Returns raw tokens. */
export function tokenizeQuery(query: string): string[] {
	return query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 0 && !STOP_WORDS.has(t));
}

/** Quote a token for an FTS5 MATCH clause, escaping embedded quotes. */
export function quoteToken(token: string): string {
	return `"${token.replace(/"/g, '""')}"`;
}

/** Join quoted tokens into a MATCH clause with the given separator. */
export function toMatchClause(
	tokens: string[],
	separator: " OR " | " AND ",
): string {
	return tokens.map(quoteToken).join(separator);
}
