import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export type TokenCostTotal = {
	tokens: number;
	cost: number;
};

export type ProviderUsageTotals = {
	day: TokenCostTotal;
	month: TokenCostTotal;
};

export type CachedMessageEntry = {
	timestamp: number;
	provider: string;
	tokens: number;
	cost: number;
};

export type SessionDirectoryEntry = { name: string; isDirectory(): boolean };

export interface SessionFileSystem {
	existsSync: (path: string) => boolean;
	readdirSync: (path: string, options?: { withFileTypes?: boolean }) => Array<string | SessionDirectoryEntry>;
	readFileSync: (path: string, encoding: "utf8") => string;
	statSync: (path: string) => { mtimeMs: number };
}

export const defaultSessionFs: SessionFileSystem = {
	existsSync,
	readdirSync: (path: string, options?: { withFileTypes?: boolean }) => {
		if (options?.withFileTypes) {
			return readdirSync(path, { withFileTypes: true });
		}
		return readdirSync(path);
	},
	readFileSync,
	statSync,
};

export function getBillingWindowStartTimes(now: Date = new Date()): { startOfDay: number; startOfMonth: number } {
	const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	return { startOfDay, startOfMonth };
}

export function parseSessionLine(line: string): CachedMessageEntry | null {
	if (!line?.includes('"assistant"')) return null;
	try {
		const json = JSON.parse(line) as {
			type?: string;
			timestamp?: string;
			provider?: string;
			message?: {
				role?: string;
				provider?: string;
				timestamp?: number;
				usage?: {
					input?: number;
					output?: number;
					cacheRead?: number;
					cacheWrite?: number;
					cost?: { total?: number };
				};
			};
		};

		if (json.type !== "message" || json.message?.role !== "assistant") return null;

		const provider = (json.message.provider ?? json.provider ?? "").toLowerCase();
		if (!provider) return null;

		const u = json.message.usage;
		if (!u) return null;

		const timestamp =
			typeof json.timestamp === "string" ? new Date(json.timestamp).getTime() : (json.message.timestamp ?? 0);

		const tokens =
			(typeof u.input === "number" ? u.input : 0) +
			(typeof u.output === "number" ? u.output : 0) +
			(typeof u.cacheRead === "number" ? u.cacheRead : 0) +
			(typeof u.cacheWrite === "number" ? u.cacheWrite : 0);

		const cost = typeof u.cost?.total === "number" ? u.cost.total : 0;

		return { timestamp, provider, tokens, cost };
	} catch {
		return null;
	}
}

export function findSessionFiles(sessionsDir: string, sfs: SessionFileSystem = defaultSessionFs): string[] {
	if (!sfs.existsSync(sessionsDir)) return [];

	const files: string[] = [];
	try {
		const entries = sfs.readdirSync(sessionsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (typeof entry === "string") {
				if (entry.endsWith(".jsonl")) files.push(join(sessionsDir, entry));
				continue;
			}
			const full = join(sessionsDir, entry.name);
			if (entry.isDirectory()) {
				try {
					const subEntries = sfs.readdirSync(full);
					for (const file of subEntries) {
						const name = typeof file === "string" ? file : file.name;
						if (name.endsWith(".jsonl")) files.push(join(full, name));
					}
				} catch {
					// Ignore unreadable subdirectories
				}
			} else if (entry.name.endsWith(".jsonl")) {
				files.push(full);
			}
		}
	} catch {
		// Ignore unreadable session directory
	}
	return files;
}

export function getRootSessionsDir(
	projectSessionDir?: string,
	sfs: SessionFileSystem = defaultSessionFs,
): string | undefined {
	if (projectSessionDir) {
		const parent = resolve(projectSessionDir, "..");
		if (sfs.existsSync(parent)) return parent;
	}
	if (process.env.PI_SESSIONS_DIR && sfs.existsSync(process.env.PI_SESSIONS_DIR)) {
		return process.env.PI_SESSIONS_DIR;
	}
	return undefined;
}
