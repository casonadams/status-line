import { parseDateish } from "../helpers.ts";
import type { QuotaWindow } from "../types.ts";
import type {
	AntigravityModel,
	AntigravityQuotaBucket,
	AntigravityQuotaGroup,
	AntigravityUsageResponse,
} from "./google_antigravity_types.ts";

function parseBucketWindow(bucket: AntigravityQuotaBucket): "5h" | "7d" | undefined {
	const key = `${bucket.window ?? ""} ${bucket.bucketId ?? ""} ${bucket.displayName ?? ""}`.toLowerCase();
	if (key.includes("5h") || key.includes("hour")) return "5h";
	if (key.includes("week") || key.includes("7d")) return "7d";
	if (bucket.resetTime) {
		const resetSec = Math.max(0, Math.round((parseDateish(bucket.resetTime).getTime() - Date.now()) / 1000));
		return resetSec > 36 * 3600 ? "7d" : "5h";
	}
	return undefined;
}

function isGroupMatchingModel(group: AntigravityQuotaGroup, modelId: string): boolean {
	const model = modelId.toLowerCase();
	const groupText =
		`${group.displayName ?? ""} ${(group.buckets ?? []).map((b) => b.bucketId ?? "").join(" ")}`.toLowerCase();
	if (model.includes("gemini")) return groupText.includes("gemini");
	if (/claude|gpt|3p|sonnet|opus/.test(model)) return /claude|gpt|3p/.test(groupText);
	return groupText.includes(model);
}

function groupMinRemaining(group: AntigravityQuotaGroup): number {
	const buckets = group.buckets ?? [];
	if (buckets.length === 0) return 1;
	return Math.min(...buckets.map((b) => b.remainingFraction ?? 0));
}

function selectQuotaGroup(groups: AntigravityQuotaGroup[], modelId?: string): AntigravityQuotaGroup | undefined {
	if (groups.length === 0) return undefined;
	if (modelId) {
		const matched = groups.find((g) => isGroupMatchingModel(g, modelId));
		if (matched) return matched;
	}
	return groups.reduce<AntigravityQuotaGroup>((lowest, group) => {
		return groupMinRemaining(group) < groupMinRemaining(lowest) ? group : lowest;
	}, groups[0]);
}

function buildWindowFromBucket(bucket: AntigravityQuotaBucket, label: "5h" | "7d"): QuotaWindow {
	const remainingFraction = Math.max(0, Math.min(1, bucket.remainingFraction ?? 0));
	const usedPercent = Math.round((1 - remainingFraction) * 100);
	const resetsAt = bucket.resetTime ? parseDateish(bucket.resetTime) : undefined;
	const isLimited = bucket.remainingFraction !== undefined && remainingFraction <= 0;

	return {
		label,
		usedPercent,
		resetsAt,
		usedValue: usedPercent,
		limitValue: 100,
		limited: isLimited,
	};
}

function parseSummaryBuckets(buckets: AntigravityQuotaBucket[]): QuotaWindow[] {
	let fiveHourBucket: AntigravityQuotaBucket | undefined;
	let weeklyBucket: AntigravityQuotaBucket | undefined;

	for (const bucket of buckets) {
		const windowType = parseBucketWindow(bucket);
		if (windowType === "5h") {
			if (!fiveHourBucket || (bucket.remainingFraction ?? 0) < (fiveHourBucket.remainingFraction ?? 0)) {
				fiveHourBucket = bucket;
			}
		} else if (windowType === "7d") {
			if (!weeklyBucket || (bucket.remainingFraction ?? 0) < (weeklyBucket.remainingFraction ?? 0)) {
				weeklyBucket = bucket;
			}
		}
	}

	const windows: QuotaWindow[] = [];
	if (fiveHourBucket) windows.push(buildWindowFromBucket(fiveHourBucket, "5h"));
	if (weeklyBucket) windows.push(buildWindowFromBucket(weeklyBucket, "7d"));
	return windows;
}

function extractGroups(data: AntigravityUsageResponse): AntigravityQuotaGroup[] {
	if (data.groups?.length) return data.groups;
	if (!data.buckets?.length) return [];
	const byPrefix = new Map<string, AntigravityQuotaBucket[]>();
	for (const bucket of data.buckets) {
		const prefix = bucket.bucketId?.split("-")[0] || "default";
		const list = byPrefix.get(prefix) ?? [];
		list.push(bucket);
		byPrefix.set(prefix, list);
	}
	return Array.from(byPrefix.entries()).map(([displayName, buckets]) => ({ displayName, buckets }));
}

function selectModelQuota(
	models: Record<string, AntigravityModel>,
	modelId: string | undefined,
): AntigravityModel["quotaInfo"] {
	const entries = Object.entries(models).filter(([, model]) => model.quotaInfo);
	const normalizedModel = modelId?.toLowerCase();
	const matching = normalizedModel
		? entries.filter(([id]) => {
				const normalizedId = id.toLowerCase();
				return normalizedId === normalizedModel || normalizedId.startsWith(`${normalizedModel}-`);
			})
		: [];
	const candidates = matching.length > 0 ? matching : entries;
	return candidates.reduce<AntigravityModel["quotaInfo"]>((lowest, [, model]) => {
		if (!lowest) return model.quotaInfo;
		const remaining = model.quotaInfo?.remainingFraction ?? 0;
		return remaining < (lowest.remainingFraction ?? 0) ? model.quotaInfo : lowest;
	}, undefined);
}

export function parseGoogleAntigravityUsage(
	data: AntigravityUsageResponse | undefined,
	modelId?: string,
): QuotaWindow[] {
	if (!data) return [];
	const groups = extractGroups(data);
	if (groups.length > 0) {
		const group = selectQuotaGroup(groups, modelId);
		if (group?.buckets?.length) {
			const windows = parseSummaryBuckets(group.buckets);
			if (windows.length > 0) return windows;
		}
	}

	const quota = selectModelQuota(data.models ?? {}, modelId);
	if (!quota) return [];

	const remainingFraction = Math.max(0, Math.min(1, quota.remainingFraction ?? 0));
	const usedPercent = Math.round((1 - remainingFraction) * 100);
	const resetsAt = parseDateish(quota.resetTime);
	const resetSeconds = Math.max(0, Math.round((resetsAt.getTime() - Date.now()) / 1000));
	const isWeekly = resetSeconds > 36 * 60 * 60;

	return [
		{
			label: isWeekly ? "7d" : "5h",
			usedPercent,
			resetsAt,
			usedValue: usedPercent,
			limitValue: 100,
		},
	];
}
