import { failure, fetchJson, type QuotaAuth, success } from "../helpers.ts";
import type { QuotasResult } from "../types.ts";
import { parseGoogleAntigravityUsage } from "./google_antigravity_parse.ts";
import type { AntigravityModelsResponse, AntigravityQuotaSummaryResponse } from "./google_antigravity_types.ts";

export * from "./google_antigravity_parse.ts";
export * from "./google_antigravity_types.ts";

interface AntigravityAuth {
	token: string;
	projectId?: string;
}

interface AntigravityCredential {
	access?: string;
	access_token?: string;
	accessToken?: string;
	token?: string;
	apiKey?: string;
	projectId?: string;
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
		resolved = { ...resolved, ...authFromApiKey(await auth.getApiKey(key)) };
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

export async function fetchGoogleAntigravityQuotas(auth: QuotaAuth): Promise<QuotasResult> {
	const credentials = await resolveAntigravityAuth(auth);
	if (!credentials.token) return failure("No Google Antigravity OAuth token found", "config");

	const body = JSON.stringify(credentials.projectId ? { project: credentials.projectId } : {});
	const headers = {
		Authorization: `Bearer ${credentials.token}`,
		"Content-Type": "application/json",
		Accept: "application/json",
		"Accept-Encoding": "identity",
		"User-Agent": "antigravity",
	};

	const summaryResult = await fetchJson<AntigravityQuotaSummaryResponse>(
		"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
		{
			method: "POST",
			headers,
			body,
		},
	);

	if (summaryResult.ok && (summaryResult.data?.groups?.length || summaryResult.data?.buckets?.length)) {
		const windows = parseGoogleAntigravityUsage(summaryResult.data, auth.modelId);
		if (windows.length > 0) {
			return success("google-antigravity", windows);
		}
	}

	if (!credentials.projectId) {
		if (!summaryResult.ok) return failure(summaryResult.message, summaryResult.kind);
		return failure("No Google Antigravity project id found", "config");
	}

	const modelsResult = await fetchJson<AntigravityModelsResponse>(
		"https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
		{
			method: "POST",
			headers,
			body,
		},
	);

	if (!modelsResult.ok) {
		const errorResult = !summaryResult.ok ? summaryResult : modelsResult;
		return failure(errorResult.message, errorResult.kind);
	}

	return success("google-antigravity", parseGoogleAntigravityUsage(modelsResult.data, auth.modelId));
}
