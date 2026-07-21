import { failure, fetchJson, parseDateish, providerAccessToken, type QuotaAuth, success } from "../helpers.ts";
import type { QuotaWindow } from "../types.ts";

interface CodexCredential {
	accountId?: string;
}

interface RateLimitWindow {
	percent_left?: number;
	remaining_percent?: number;
	used_percent?: number;
	reset_at?: string | number;
	reset_time_ms?: number;
	limit_window_seconds?: number;
}

interface RateLimitShape {
	primary_window?: RateLimitWindow;
	primary?: RateLimitWindow;
	five_hour_limit?: RateLimitWindow;
	five_hour?: RateLimitWindow;
	secondary_window?: RateLimitWindow;
	secondary?: RateLimitWindow;
	weekly_limit?: RateLimitWindow;
	weekly?: RateLimitWindow;
}

interface CodexUsageResponse {
	rate_limit?: RateLimitShape;
	rate_limits?: RateLimitShape;
	credits?: {
		has_credits?: boolean;
		balance?: number;
	};
}

function codexAccountId(auth: QuotaAuth): string | undefined {
	const credential = auth.getCredential("openai-codex") as CodexCredential | undefined;
	if (typeof credential?.accountId === "string") return credential.accountId;
	return undefined;
}

function pickFirstNumber(values: Array<number | null | undefined>): number | undefined {
	for (const value of values) {
		if (value != null) return Number(value);
	}
	return undefined;
}

function percentLeftToUsedPercent(limit: RateLimitWindow | undefined): number {
	const percentLeft = pickFirstNumber([limit?.percent_left, limit?.remaining_percent]);
	if (percentLeft != null) return Math.max(0, 100 - percentLeft);
	const usedPercent = pickFirstNumber([limit?.used_percent]);
	if (usedPercent != null) return usedPercent;
	return 0;
}

export function parseCodexUsage(data: CodexUsageResponse | undefined): QuotaWindow[] {
	const rateLimit = data?.rate_limit ?? data?.rate_limits ?? {};
	const primary = rateLimit.primary_window ?? rateLimit.primary ?? rateLimit.five_hour_limit ?? rateLimit.five_hour;
	const secondary = rateLimit.secondary_window ?? rateLimit.secondary ?? rateLimit.weekly_limit ?? rateLimit.weekly;
	const windows: QuotaWindow[] = [];

	if (primary) {
		windows.push({
			provider: "openai-codex",
			label: "5h",
			usedPercent: percentLeftToUsedPercent(primary),
			resetsAt: parseDateish(primary.reset_at ?? primary.reset_time_ms),
			windowSeconds: Number(primary.limit_window_seconds ?? 5 * 60 * 60),
			usedValue: percentLeftToUsedPercent(primary),
			limitValue: 100,
		});
	}
	if (secondary) {
		windows.push({
			provider: "openai-codex",
			label: "7d",
			usedPercent: percentLeftToUsedPercent(secondary),
			resetsAt: parseDateish(secondary.reset_at ?? secondary.reset_time_ms),
			windowSeconds: Number(secondary.limit_window_seconds ?? 7 * 24 * 60 * 60),
			usedValue: percentLeftToUsedPercent(secondary),
			limitValue: 100,
		});
	}
	const credits = data?.credits;
	if (credits?.has_credits && credits.balance != null) {
		const balance = Number(credits.balance);
		windows.push({
			provider: "openai-codex",
			label: "Credits",
			usedPercent: 0,
			resetsAt: new Date(0),
			windowSeconds: 0,
			usedValue: balance,
			limitValue: balance,
			isCurrency: true,
		});
	}
	return windows;
}

export async function fetchCodexQuotas(auth: QuotaAuth) {
	const accessToken = await providerAccessToken(auth, "openai-codex");
	const accountId = codexAccountId(auth);
	if (!accessToken) return failure("No Codex access token found", "config");
	if (!accountId) return failure("No Codex account id found", "config");

	const result = await fetchJson<CodexUsageResponse>("https://chatgpt.com/backend-api/wham/usage", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"ChatGPT-Account-Id": accountId,
			Accept: "application/json",
			Origin: "https://chatgpt.com",
			Referer: "https://chatgpt.com/",
			"User-Agent": "Mozilla/5.0",
		},
	});
	if (!result.ok) return failure(result.message, result.kind);
	return success("openai-codex", parseCodexUsage(result.data));
}
