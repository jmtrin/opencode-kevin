// UUID v7 generator — timestamp-ordered IDs.
// Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
// First 48 bits: Unix timestamp (ms). Version nibble set to 7.
// Variant nibble starts with binary 10.

let lastTs = 0;
let lastRandom: number[] = [];

function randomBytes(n: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(Math.floor(Math.random() * 256));
	return out;
}

function toHex(bytes: number[]): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++)
		out += bytes[i].toString(16).padStart(2, "0");
	return out;
}

export function uuidv7(): string {
	let ts = Date.now();
	if (ts < lastTs) ts = lastTs;
	if (ts === lastTs) {
		for (let i = 9; i >= 0; i--) {
			if (lastRandom[i] === 0xff) {
				lastRandom[i] = 0;
			} else {
				lastRandom[i]++;
				break;
			}
		}
	} else {
		lastRandom = randomBytes(10);
	}
	lastTs = ts;

	const rand = lastRandom;
	const bytes: number[] = new Array(16).fill(0);

	bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
	bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
	bytes[2] = (ts >>> 24) & 0xff;
	bytes[3] = (ts >>> 16) & 0xff;
	bytes[4] = (ts >>> 8) & 0xff;
	bytes[5] = ts & 0xff;

	bytes[6] = 0x70 | (rand[0] & 0x0f);
	bytes[7] = rand[1];
	bytes[8] = 0x80 | (rand[2] & 0x3f);
	bytes[9] = rand[3];
	bytes[10] = rand[4];
	bytes[11] = rand[5];
	bytes[12] = rand[6];
	bytes[13] = rand[7];
	bytes[14] = rand[8];
	bytes[15] = rand[9];

	const hex = toHex(bytes);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
