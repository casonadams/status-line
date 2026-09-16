import { failure, fetchJson, type QuotaAuth, success } from "../helpers.ts";
import type { QuotasResult } from "../types.ts";
import { parseGoogleAntigravityUsage } from "./google_antigravity_parse.ts";
import type { AntigravityModelsResponse, AntigravityQuotaSummaryResponse } from "./google_antigravity_types.ts";

export * from "./google_antigravity_parse.ts";
export * from "./google_antigravity_types.ts";

const ENDPOINT_CANDIDATES: readonly string[] = [
	"https://daily-cloudcode-pa.googleapis.com",
	"https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://cloudcode-pa.googleapis.com",
];

function endpointCandidates(): readonly string[] {
	const custom = process.env.ANTIGRAVITY_BASE_URL?.trim();
	return custom ? [custom] : ENDPOINT_CANDIDATES;
}

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

async function fetchSummaryWindows(headers: Record<string, string>, body: string, modelId?: string) {
	let error: { message: string; kind: "timeout" | "cancelled" | "http" | "network" } | undefined;
	for (const endpoint of endpointCandidates()) {
		const res = await fetchJson<AntigravityQuotaSummaryResponse>(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
			method: "POST",
			headers,
			body,
		});
		if (res.ok && (res.data?.groups?.length || res.data?.buckets?.length)) {
			const windows = parseGoogleAntigravityUsage(res.data, modelId);
			if (windows.length > 0) return { windows };
		}
		if (!res.ok) error = res;
	}
	return { error };
}

async function fetchModelsWindows(headers: Record<string, string>, body: string, modelId?: string) {
	let error: { message: string; kind: "timeout" | "cancelled" | "http" | "network" } | undefined;
	for (const endpoint of endpointCandidates()) {
		const res = await fetchJson<AntigravityModelsResponse>(`${endpoint}/v1internal:fetchAvailableModels`, {
			method: "POST",
			headers,
			body,
		});
		if (res.ok) return { windows: parseGoogleAntigravityUsage(res.data, modelId) };
		error = res;
	}
	return { error };
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

	const summary = await fetchSummaryWindows(headers, body, auth.modelId);
	if (summary.windows) return success("google-antigravity", summary.windows);

	if (!credentials.projectId) {
		if (summary.error) return failure(summary.error.message, summary.error.kind);
		return failure("No Google Antigravity project id found", "config");
	}

	const models = await fetchModelsWindows(headers, body, auth.modelId);
	if (models.windows) return success("google-antigravity", models.windows);

	const error = summary.error ?? models.error;
	if (error) return failure(error.message, error.kind);
	return failure("Failed to fetch Google Antigravity quotas", "http");
}
