import { failure, fetchJson, parseDateish, type QuotaAuth, safePercent, success } from "../helpers.ts";
import type { QuotasResult, QuotaWindow } from "../types.ts";

interface AnthropicWindow {
	utilization?: number;
	resets_at?: string | number;
}

interface AnthropicExtraUsage {
	is_enabled?: boolean;
	monthly_limit?: number;
	used_credits?: number;
	utilization?: number;
}

interface AnthropicUsageResponse {
	five_hour?: AnthropicWindow;
	seven_day?: AnthropicWindow;
	extra_usage?: AnthropicExtraUsage;
}

export function parseAnthropicUsage(data: AnthropicUsageResponse | undefined): QuotaWindow[] {
	const windows: QuotaWindow[] = [];
	if (data?.five_hour) {
		windows.push({
			label: "5h",
			usedPercent: Number(data.five_hour.utilization ?? 0),
			resetsAt: parseDateish(data.five_hour.resets_at),
			usedValue: Number(data.five_hour.utilization ?? 0),
			limitValue: 100,
		});
	}
	if (data?.seven_day) {
		windows.push({
			label: "7d",
			usedPercent: Number(data.seven_day.utilization ?? 0),
			resetsAt: parseDateish(data.seven_day.resets_at),
			usedValue: Number(data.seven_day.utilization ?? 0),
			limitValue: 100,
		});
	}
	const extra = data?.extra_usage;
	if (extra?.is_enabled && extra.monthly_limit != null) {
		const limitDollars = extra.monthly_limit / 100;
		const usedDollars = (extra.used_credits ?? 0) / 100;
		windows.push({
			label: "Extra",
			usedPercent: Number(extra.utilization ?? safePercent(usedDollars, limitDollars)),
			resetsAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
			usedValue: usedDollars,
			limitValue: limitDollars,
			isCurrency: true,
		});
	}
	return windows;
}

export async function fetchAnthropicQuotas(auth: QuotaAuth): Promise<QuotasResult> {
	const accessToken = await auth.getApiKey("anthropic");
	if (!accessToken) return failure("No Anthropic OAuth token found", "config");
	const result = await fetchJson<AnthropicUsageResponse>("https://api.anthropic.com/api/oauth/usage", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"anthropic-beta": "oauth-2025-04-20",
			Accept: "application/json",
		},
	});
	if (!result.ok) return failure(result.message, result.kind);
	return success("anthropic", parseAnthropicUsage(result.data));
}
