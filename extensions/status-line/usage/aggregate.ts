import { resolve } from "node:path";
import {
	type CachedMessageEntry,
	defaultSessionFs,
	findSessionFiles,
	getBillingWindowStartTimes,
	type ProviderUsageTotals,
	parseSessionLine,
	type SessionFileSystem,
	type TokenCostTotal,
} from "./aggregate_parse.ts";

export * from "./aggregate_parse.ts";

type CachedFile = {
	mtimeMs: number;
	entries: CachedMessageEntry[];
};

function accumulateWindowUsage(
	entry: CachedMessageEntry,
	windows: { startOfDay: number; startOfMonth: number },
	totals: { day: TokenCostTotal; month: TokenCostTotal },
): void {
	if (entry.timestamp >= windows.startOfMonth) {
		totals.month.tokens += entry.tokens;
		totals.month.cost += entry.cost;
	}
	if (entry.timestamp >= windows.startOfDay) {
		totals.day.tokens += entry.tokens;
		totals.day.cost += entry.cost;
	}
}

export class SessionUsageAggregator {
	private readonly fileCache = new Map<string, CachedFile>();
	private readonly sfs: SessionFileSystem;

	constructor(sfs: SessionFileSystem = defaultSessionFs) {
		this.sfs = sfs;
	}

	clearCache(): void {
		this.fileCache.clear();
	}

	private readCachedEntries(filePath: string, startOfMonth: number): CachedMessageEntry[] {
		try {
			const stat = this.sfs.statSync(filePath);
			if (stat.mtimeMs < startOfMonth) return [];

			const cached = this.fileCache.get(filePath);
			if (cached && cached.mtimeMs === stat.mtimeMs) return cached.entries;

			const entries: CachedMessageEntry[] = [];
			const lines = this.sfs.readFileSync(filePath, "utf8").split("\n");
			for (const line of lines) {
				const parsed = parseSessionLine(line);
				if (parsed) entries.push(parsed);
			}
			this.fileCache.set(filePath, { mtimeMs: stat.mtimeMs, entries });
			return entries;
		} catch {
			return [];
		}
	}

	private aggregateMemoryEntries(
		options: {
			entries: readonly unknown[];
			targetProvider: string;
			activeModelProvider: string | undefined;
			windows: { startOfDay: number; startOfMonth: number; nowMs: number };
		},
		totals: { day: TokenCostTotal; month: TokenCostTotal },
	): void {
		const { entries, targetProvider, activeModelProvider, windows } = options;
		for (const raw of entries as Array<{
			type?: string;
			timestamp?: string;
			message?: {
				role?: string;
				provider?: string;
				timestamp?: number;
				usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
			};
		}>) {
			if (raw?.type !== "message" || raw.message?.role !== "assistant") continue;
			const p = (raw.message.provider ?? activeModelProvider ?? "").toLowerCase();
			if (p !== targetProvider) continue;

			const u = raw.message.usage;
			const tokens =
				(typeof u?.input === "number" ? u.input : 0) +
				(typeof u?.output === "number" ? u.output : 0) +
				(typeof u?.cacheRead === "number" ? u.cacheRead : 0) +
				(typeof u?.cacheWrite === "number" ? u.cacheWrite : 0);
			const cost = typeof u?.cost?.total === "number" ? u.cost.total : 0;
			const timestamp = raw.timestamp ? new Date(raw.timestamp).getTime() : (raw.message.timestamp ?? windows.nowMs);

			accumulateWindowUsage({ timestamp, provider: p, tokens, cost }, windows, totals);
		}
	}

	getProviderUsage(options: {
		provider: string;
		sessionsDir?: string;
		currentSessionFile?: string;
		currentEntries?: readonly unknown[];
		activeModelProvider?: string;
		now?: Date;
	}): ProviderUsageTotals {
		const {
			provider,
			sessionsDir,
			currentSessionFile,
			currentEntries = [],
			activeModelProvider,
			now = new Date(),
		} = options;
		const targetProvider = provider.toLowerCase();
		const { startOfDay, startOfMonth } = getBillingWindowStartTimes(now);
		const totals: ProviderUsageTotals = { day: { tokens: 0, cost: 0 }, month: { tokens: 0, cost: 0 } };

		if (sessionsDir) {
			const resolvedCurrentFile = currentSessionFile ? resolve(currentSessionFile) : undefined;
			for (const filePath of findSessionFiles(sessionsDir, this.sfs)) {
				if (resolvedCurrentFile && resolve(filePath) === resolvedCurrentFile) continue;
				for (const entry of this.readCachedEntries(filePath, startOfMonth)) {
					if (entry.provider === targetProvider) {
						accumulateWindowUsage(entry, { startOfDay, startOfMonth }, totals);
					}
				}
			}
		}

		this.aggregateMemoryEntries(
			{
				entries: currentEntries,
				targetProvider,
				activeModelProvider,
				windows: { startOfDay, startOfMonth, nowMs: now.getTime() },
			},
			totals,
		);
		return totals;
	}
}
