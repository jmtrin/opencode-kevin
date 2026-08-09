/**
 * K4-013 — shared FTS5 query tokenizer.
 *
 * Injection recall ORs the quoted tokens (`"t1" OR "t2"`) while
 * `kevin_why` ANDs them (`"t1" AND "t2"`).
 */

export const STOP_WORDS = new Set<string>([
	"a",
	"an",
	"and",
	"are",
	"at",
	"be",
	"been",
	"but",
	"by",
	"did",
	"do",
	"does",
	"el",
	"eso",
	"for",
	"how",
	"i",
	"if",
	"in",
	"is",
	"it",
	"la",
	"las",
	"los",
	"mi",
	"my",
	"o",
	"of",
	"on",
	"or",
	"para",
	"por",
	"que",
	"she",
	"su",
	"that",
	"the",
	"this",
	"to",
	"tu",
	"un",
	"una",
	"we",
	"were",
	"what",
	"when",
	"where",
	"which",
	"who",
	"why",
	"with",
	"y",
	"you",
	"como",
	"con",
	"de",
	"en",
	"he",
	"they",
	"was",
	"sin",
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
