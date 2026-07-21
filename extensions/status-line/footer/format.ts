import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { fitRightAligned, formatTokens, sanitizeStatusText } from "../formatters.ts";

const INLINE_STATUS_KEYS = new Set(["status-line", "optimizer"]);

type SessionUsageTotals = {
	totalInput: number;
	totalOutput: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalCost: number;
	usingSubscription: boolean;
};

function getStatus(statuses: ReadonlyMap<string, string | undefined>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = statuses.get(key);
		if (value) return value;
	}
	return undefined;
}

function getTopRightStatus(footerData: ReadonlyFooterDataProvider): string | undefined {
	const statuses = footerData.getExtensionStatuses();
	return (
		getStatus(statuses, "status-line", "quotas", "pi-quotas-usage") ??
		Array.from(statuses.entries()).find(([key, text]) => text && !INLINE_STATUS_KEYS.has(key))?.[1]
	);
}

function getOptimizerStatus(footerData: ReadonlyFooterDataProvider): string | undefined {
	return footerData.getExtensionStatuses().get("optimizer");
}

function getSessionUsageTotals(ctx: ExtensionContext): SessionUsageTotals {
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = entry.message.usage as
			| {
					input?: number;
					output?: number;
					cacheRead?: number;
					cacheWrite?: number;
					cost?: { total?: number };
			  }
			| undefined;
		totalInput += typeof usage?.input === "number" ? usage.input : 0;
		totalOutput += typeof usage?.output === "number" ? usage.output : 0;
		totalCacheRead += typeof usage?.cacheRead === "number" ? usage.cacheRead : 0;
		totalCacheWrite += typeof usage?.cacheWrite === "number" ? usage.cacheWrite : 0;
		totalCost += typeof usage?.cost?.total === "number" ? usage.cost.total : 0;
	}

	return {
		totalInput,
		totalOutput,
		totalCacheRead,
		totalCacheWrite,
		totalCost,
		usingSubscription: !!ctx.model && ctx.modelRegistry.isUsingOAuth(ctx.model),
	};
}

function getCurrentThinkingLevel(ctx: ExtensionContext): string {
	interface ThinkingLevelChangeEntry {
		thinkingLevel?: string;
	}

	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "thinking_level_change") {
			const level = (entry as ThinkingLevelChangeEntry).thinkingLevel;
			if (typeof level === "string") return level;
		}
	}
	return "off";
}

export function formatTopLine(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider, width: number): string {
	const theme = ctx.ui.theme;
	const home = process.env.HOME || process.env.USERPROFILE;
	let pwd = ctx.sessionManager.getCwd();
	if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;
	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) pwd = `${pwd} • ${sessionName}`;
	const left = theme.fg("dim", pwd);
	const status = getTopRightStatus(footerData);
	return status ? fitRightAligned(left, status, width) : truncateToWidth(left, width, theme.fg("dim", "..."));
}

function buildUsageParts(totals: SessionUsageTotals, contextPercent: string, contextWindow: number): string[] {
	const parts: string[] = [];
	if (totals.totalInput) parts.push(`↑${formatTokens(totals.totalInput)}`);
	if (totals.totalOutput) parts.push(`↓${formatTokens(totals.totalOutput)}`);
	if (totals.totalCacheRead) parts.push(`R${formatTokens(totals.totalCacheRead)}`);
	if (totals.totalCacheWrite) parts.push(`W${formatTokens(totals.totalCacheWrite)}`);
	if (totals.totalCost || totals.usingSubscription) parts.push(`$${totals.totalCost.toFixed(3)}`);
	parts.push(`${contextPercent}/${formatTokens(contextWindow)}`);
	return parts;
}

export function formatStatsLine(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider, width: number): string {
	const theme = ctx.ui.theme;
	const totals = getSessionUsageTotals(ctx);
	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercent = contextUsage?.percent == null ? "?" : `${contextUsage.percent.toFixed(1)}%`;
	const parts = buildUsageParts(totals, contextPercent, contextWindow);

	const optimizerStatus = getOptimizerStatus(footerData);
	const left = theme.fg(
		"dim",
		[parts.join(" "), optimizerStatus && sanitizeStatusText(optimizerStatus)].filter(Boolean).join(" "),
	);
	const modelId = ctx.model?.id || "no-model";
	const right = ctx.model?.reasoning
		? theme.fg("dim", `${modelId} • ${getCurrentThinkingLevel(ctx)}`)
		: theme.fg("dim", modelId);
	return fitRightAligned(left, right, width);
}

export function formatExtensionStatuses(footerData: ReadonlyFooterDataProvider, width: number): string | undefined {
	const statuses = Array.from(footerData.getExtensionStatuses().entries())
		.filter(([key, text]) => text && !INLINE_STATUS_KEYS.has(key))
		.map(([, text]) => sanitizeStatusText(text as string));
	if (statuses.length === 0) return undefined;
	return truncateToWidth(statuses.join(" "), width, "...");
}
