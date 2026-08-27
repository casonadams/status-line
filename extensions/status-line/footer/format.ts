import { isAbsolute, relative, resolve, sep } from "node:path";
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

type UsageEntry = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
};

type SelectedStatus = { key: string; text: string };

function getStatus(statuses: ReadonlyMap<string, string | undefined>, ...keys: string[]): SelectedStatus | undefined {
	for (const key of keys) {
		const text = statuses.get(key);
		if (text) return { key, text };
	}
	return undefined;
}

function getTopRightStatus(footerData: ReadonlyFooterDataProvider): SelectedStatus | undefined {
	return getStatus(footerData.getExtensionStatuses(), "status-line", "quotas", "pi-quotas-usage");
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
		const usage = entry.message.usage as UsageEntry | undefined;
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
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (
			entry.type === "thinking_level_change" &&
			typeof (entry as { thinkingLevel?: string }).thinkingLevel === "string"
		) {
			return (entry as { thinkingLevel: string }).thinkingLevel;
		}
	}
	return "off";
}

function abbreviateHome(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const relativePath = relative(resolve(home), resolve(cwd));
	const isInside =
		relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
	if (!isInside) return cwd;
	return relativePath ? `~${sep}${relativePath}` : "~";
}

export function formatTopLine(
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
	options: { width: number },
): string {
	const { width } = options;
	const theme = ctx.ui.theme;
	const home = process.env.HOME || process.env.USERPROFILE;
	let pwd = abbreviateHome(ctx.sessionManager.getCwd(), home);
	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;
	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) pwd = `${pwd} • ${sessionName}`;
	const left = theme.fg("dim", pwd);
	const status = getTopRightStatus(footerData);
	return status
		? fitRightAligned(left, sanitizeStatusText(status.text), width)
		: truncateToWidth(left, width, theme.fg("dim", "..."));
}

function buildUsageParts(
	totals: SessionUsageTotals,
	display: { contextPercent: string; contextWindow: number; tokensPerSecond?: number },
): string[] {
	const { contextPercent, contextWindow, tokensPerSecond } = display;
	const parts: string[] = [];
	if (totals.totalInput) parts.push(`↑${formatTokens(totals.totalInput)}`);
	if (totals.totalOutput) parts.push(`↓${formatTokens(totals.totalOutput)}`);
	if (totals.totalCacheRead) parts.push(`R${formatTokens(totals.totalCacheRead)}`);
	if (totals.totalCacheWrite) parts.push(`W${formatTokens(totals.totalCacheWrite)}`);
	if (totals.totalCost || totals.usingSubscription) parts.push(`$${totals.totalCost.toFixed(3)}`);
	parts.push(`${contextPercent}/${formatTokens(contextWindow)}`);
	if (tokensPerSecond != null) parts.push(`@${tokensPerSecond.toFixed(1)}t/s`);
	return parts;
}

export function formatStatsLine(
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
	options: { width: number; showExtensionStatuses?: boolean; tokensPerSecond?: number },
): string {
	const { width, showExtensionStatuses = false, tokensPerSecond } = options;
	const theme = ctx.ui.theme;
	const totals = getSessionUsageTotals(ctx);
	const contextUsage = ctx.getContextUsage();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercent = contextUsage?.percent == null ? "?" : `${contextUsage.percent.toFixed(1)}%`;
	const parts = buildUsageParts(totals, { contextPercent, contextWindow, tokensPerSecond });

	const optimizerStatus = getOptimizerStatus(footerData);
	const left = theme.fg(
		"dim",
		[parts.join(" "), optimizerStatus && sanitizeStatusText(optimizerStatus)].filter(Boolean).join(" "),
	);
	const modelId = ctx.model?.id || "no-model";
	const modelDetails = ctx.model?.reasoning ? `${modelId} • ${getCurrentThinkingLevel(ctx)}` : modelId;
	const hiddenCount = showExtensionStatuses ? 0 : getExtensionStatusTexts(footerData).length;
	const right = hiddenCount ? `${hiddenCount} • ${modelDetails}` : modelDetails;
	return fitRightAligned(left, theme.fg("dim", right), width);
}

function getExtensionStatusTexts(footerData: ReadonlyFooterDataProvider): string[] {
	const selected = getTopRightStatus(footerData);
	return Array.from(footerData.getExtensionStatuses().entries())
		.filter(
			(entry): entry is [string, string] =>
				Boolean(entry[1]) && !INLINE_STATUS_KEYS.has(entry[0]) && entry[0] !== selected?.key,
		)
		.map(([, text]) => sanitizeStatusText(text));
}

export function formatExtensionStatuses(footerData: ReadonlyFooterDataProvider, width: number): string | undefined {
	const statuses = getExtensionStatusTexts(footerData);
	return statuses.length > 0 ? truncateToWidth(statuses.join(" "), width, "...") : undefined;
}
