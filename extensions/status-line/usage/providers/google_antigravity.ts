import { failure, fetchJson, parseDateish, providerAccessToken, type QuotaAuth, success } from "../helpers.ts";
import type { QuotasResult, QuotaWindow } from "../types.ts";

interface AntigravityCredential {
	access?: string;
	access_token?: string;
	accessToken?: string;
	token?: string;
	apiKey?: string;
}

interface AntigravityQuotaBucket {
	bucketId?: string;
	displayName?: string;
	window?: string;
	resetTime?: string;
	remainingFraction?: number;
}

interface AntigravityQuotaSummary {
	groups?: Array<{ buckets?: AntigravityQuotaBucket[] }>;
}

function tokenFromApiKey(apiKey: string | undefined): string | undefined {
	if (!apiKey) return undefined;
	try {
		const parsed = JSON.parse(apiKey) as { token?: unknown };
		return typeof parsed.token === "string" ? parsed.token : undefined;
	} catch {
		return apiKey;
	}
}

async function resolveAntigravityToken(auth: QuotaAuth): Promise<string | undefined> {
	for (const key of ["google-antigravity", "antigravity", "google"]) {
		const token = tokenFromApiKey(await providerAccessToken(auth, key));
		if (token) return token;
		const credential = auth.getCredential(key) as AntigravityCredential | undefined;
		const stored =
			credential?.access ??
			credential?.access_token ??
			credential?.accessToken ??
			credential?.token ??
			credential?.apiKey;
		if (stored) return stored;
	}
	return undefined;
}

function quotaBuckets(data: AntigravityQuotaSummary | undefined): AntigravityQuotaBucket[] {
	return (data?.groups ?? [])
		.flatMap((group) => group.buckets ?? [])
		.filter((bucket) => {
			return typeof bucket.remainingFraction === "number" && Number.isFinite(bucket.remainingFraction);
		});
}

function selectQuotaBucket(
	buckets: readonly AntigravityQuotaBucket[],
	modelId: string | undefined,
): AntigravityQuotaBucket | undefined {
	const normalizedModel = modelId?.toLowerCase();
	const matching = normalizedModel
		? buckets.filter((bucket) => {
				const id = bucket.bucketId?.toLowerCase();
				return id === normalizedModel || id?.startsWith(`${normalizedModel}-`) || normalizedModel.startsWith(`${id}-`);
			})
		: [];
	const candidates = matching.length > 0 ? matching : buckets;
	return candidates.reduce<AntigravityQuotaBucket | undefined>((lowest, bucket) => {
		if (!lowest) return bucket;
		return Number(bucket.remainingFraction) < Number(lowest.remainingFraction) ? bucket : lowest;
	}, undefined);
}

export function parseGoogleAntigravityUsage(
	data: AntigravityQuotaSummary | undefined,
	modelId?: string,
): QuotaWindow[] {
	const bucket = selectQuotaBucket(quotaBuckets(data), modelId);
	if (!bucket) return [];

	const remainingFraction = Math.max(0, Math.min(1, Number(bucket.remainingFraction)));
	const usedPercent = Math.round((1 - remainingFraction) * 100);
	const resetsAt = parseDateish(bucket.resetTime);
	const resetSeconds = Math.max(0, Math.round((resetsAt.getTime() - Date.now()) / 1000));
	const isWeekly = bucket.window?.toLowerCase().includes("week") || resetSeconds > 36 * 60 * 60;

	return [
		{
			provider: "google-antigravity",
			label: isWeekly ? "7d" : "5h",
			usedPercent,
			resetsAt,
			windowSeconds: isWeekly ? 7 * 24 * 60 * 60 : 5 * 60 * 60,
			usedValue: usedPercent,
			limitValue: 100,
			limited: remainingFraction <= 0,
		},
	];
}

export async function fetchGoogleAntigravityQuotas(auth: QuotaAuth): Promise<QuotasResult> {
	const accessToken = await resolveAntigravityToken(auth);
	if (!accessToken) return failure("No Google Antigravity OAuth token found", "config");

	const result = await fetchJson<AntigravityQuotaSummary>(
		"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				Accept: "application/json",
				"Accept-Encoding": "identity",
				"User-Agent": "antigravity",
			},
			body: "{}",
		},
	);
	if (!result.ok) return failure(result.message, result.kind);
	return success("google-antigravity", parseGoogleAntigravityUsage(result.data, auth.modelId));
}
