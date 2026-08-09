import { failure, fetchJson, parseDateish, providerAccessToken, type QuotaAuth, success } from "../helpers.ts";
import type { QuotasResult, QuotaWindow } from "../types.ts";

interface AntigravityAuth {
	token: string;
	projectId: string;
}

interface AntigravityCredential {
	access?: string;
	access_token?: string;
	accessToken?: string;
	token?: string;
	apiKey?: string;
	projectId?: string;
}

interface AntigravityModel {
	quotaInfo?: {
		remainingFraction?: number;
		resetTime?: string;
		isExhausted?: boolean;
	};
}

interface AntigravityModelsResponse {
	models?: Record<string, AntigravityModel>;
}

function authFromApiKey(apiKey: string | undefined): Partial<AntigravityAuth> {
	if (!apiKey) return {};
	try {
		const parsed = JSON.parse(apiKey) as { token?: unknown; projectId?: unknown };
		return {
			token: typeof parsed.token === "string" ? parsed.token : undefined,
			projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
		};
	} catch {
		return { token: apiKey };
	}
}

async function resolveAntigravityAuth(auth: QuotaAuth): Promise<Partial<AntigravityAuth>> {
	let resolved: Partial<AntigravityAuth> = {};
	for (const key of ["google-antigravity", "antigravity", "google"]) {
		resolved = { ...resolved, ...authFromApiKey(await providerAccessToken(auth, key)) };
		const credential = auth.getCredential(key) as AntigravityCredential | undefined;
		resolved.token ??=
			credential?.access ??
			credential?.access_token ??
			credential?.accessToken ??
			credential?.token ??
			credential?.apiKey;
		resolved.projectId ??= credential?.projectId;
		if (resolved.token && resolved.projectId) return resolved;
	}
	return resolved;
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
	data: AntigravityModelsResponse | undefined,
	modelId?: string,
): QuotaWindow[] {
	const quota = selectModelQuota(data?.models ?? {}, modelId);
	if (!quota) return [];

	const remainingFraction = Math.max(0, Math.min(1, quota.remainingFraction ?? 0));
	const usedPercent = Math.round((1 - remainingFraction) * 100);
	const resetsAt = parseDateish(quota.resetTime);
	const resetSeconds = Math.max(0, Math.round((resetsAt.getTime() - Date.now()) / 1000));
	const isWeekly = resetSeconds > 36 * 60 * 60;

	return [
		{
			provider: "google-antigravity",
			label: isWeekly ? "7d" : "5h",
			usedPercent,
			resetsAt,
			windowSeconds: isWeekly ? 7 * 24 * 60 * 60 : 5 * 60 * 60,
			usedValue: usedPercent,
			limitValue: 100,
			limited: quota.isExhausted === true || remainingFraction <= 0,
		},
	];
}

export async function fetchGoogleAntigravityQuotas(auth: QuotaAuth): Promise<QuotasResult> {
	const credentials = await resolveAntigravityAuth(auth);
	if (!credentials.token) return failure("No Google Antigravity OAuth token found", "config");
	if (!credentials.projectId) return failure("No Google Antigravity project id found", "config");

	const result = await fetchJson<AntigravityModelsResponse>(
		"https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${credentials.token}`,
				"Content-Type": "application/json",
				Accept: "application/json",
				"Accept-Encoding": "identity",
				"User-Agent": "antigravity",
			},
			body: JSON.stringify({ project: credentials.projectId }),
		},
	);
	if (!result.ok) return failure(result.message, result.kind);
	return success("google-antigravity", parseGoogleAntigravityUsage(result.data, auth.modelId));
}
