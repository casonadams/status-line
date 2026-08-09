import {
	type FetchJsonResult,
	failure,
	fetchJson,
	parseDateish,
	providerAccessToken,
	type QuotaAuth,
	safePercent,
	success,
} from "../helpers.ts";
import type { QuotasResult, QuotaWindow } from "../types.ts";

export interface AntigravityModelQuotaInfo {
	remainingFraction?: number;
	resetTime?: string;
	isExhausted?: boolean;
}

export interface AntigravityModelInfo {
	displayName?: string;
	model?: string;
	label?: string;
	quotaInfo?: AntigravityModelQuotaInfo;
}

export interface AntigravityLoadCodeAssistResponse {
	cloudaicompanionProject?: string | { id?: string };
	planInfo?: { monthlyPromptCredits?: number; planType?: string };
	availablePromptCredits?: number;
}

export interface AntigravityFetchAvailableModelsResponse {
	models?: Record<string, AntigravityModelInfo> | AntigravityModelInfo[];
}

async function resolveAntigravityToken(auth: QuotaAuth): Promise<string | undefined> {
	for (const key of ["google-antigravity", "antigravity", "google"]) {
		const token = await providerAccessToken(auth, key);
		if (token) return token;
		const cred = auth.getCredential(key) as Record<string, unknown> | undefined;
		const found = cred?.access ?? cred?.access_token ?? cred?.accessToken ?? cred?.token ?? cred?.apiKey;
		if (typeof found === "string" && found) return found;
	}
	return undefined;
}

function extractModelEntries(
	rawModels: AntigravityFetchAvailableModelsResponse["models"],
): Array<[string, AntigravityModelInfo]> {
	const modelEntries: Array<[string, AntigravityModelInfo]> = [];
	if (Array.isArray(rawModels)) {
		for (const m of rawModels) {
			if (m && typeof m === "object") modelEntries.push([m.model || m.displayName || "unknown", m]);
		}
	} else if (rawModels && typeof rawModels === "object") {
		for (const [id, m] of Object.entries(rawModels)) {
			if (m && typeof m === "object") modelEntries.push([id, m]);
		}
	}
	return modelEntries.filter(([id, m]) => {
		if (!m.quotaInfo) return false;
		if (id.startsWith("chat_") || id.startsWith("tab_") || id.startsWith("rev")) return false;
		return !id.includes("image") && !id.includes("mquery") && !id.includes("lite");
	});
}

export function parseGoogleAntigravityUsage(
	codeAssistData?: AntigravityLoadCodeAssistResponse,
	modelsData?: AntigravityFetchAvailableModelsResponse,
): QuotaWindow[] {
	const windows: QuotaWindow[] = [];
	const validModels = extractModelEntries(modelsData?.models);

	for (let i = 0; i < validModels.length; i++) {
		const [, m] = validModels[i];
		const quota = m.quotaInfo;
		if (!quota) continue;
		const remainingFraction = Math.max(0, Math.min(1, quota.remainingFraction ?? 1));
		const usedPercent = Math.max(0, Math.min(100, Math.round((1 - remainingFraction) * 100)));
		const resetsAt = parseDateish(quota.resetTime);
		const isWeekly = resetsAt.getTime() - Date.now() > 36 * 60 * 60 * 1000;
		const label = i === 0 ? "5h" : windows.some((w) => w.label === "5h") ? "7d" : "5h";

		windows.push({
			provider: "google-antigravity",
			label,
			usedPercent,
			resetsAt,
			windowSeconds: isWeekly ? 7 * 24 * 60 * 60 : 5 * 60 * 60,
			usedValue: usedPercent,
			limitValue: 100,
			limited: Boolean(quota.isExhausted || remainingFraction <= 0),
		});
	}

	const credits = codeAssistData?.availablePromptCredits;
	const monthly = codeAssistData?.planInfo?.monthlyPromptCredits;
	if (monthly != null && monthly > 0 && credits != null) {
		windows.push({
			provider: "google-antigravity",
			label: "Credits",
			usedPercent: safePercent(Math.max(0, monthly - credits), monthly),
			resetsAt: new Date(0),
			windowSeconds: 0,
			usedValue: credits,
			limitValue: monthly,
		});
	}

	return windows;
}

export async function fetchGoogleAntigravityQuotas(auth: QuotaAuth): Promise<QuotasResult> {
	const accessToken = await resolveAntigravityToken(auth);
	if (!accessToken) return failure("No Google Antigravity OAuth token found", "config");

	const baseUrls = ["https://cloudcode-pa.googleapis.com", "https://daily-cloudcode-pa.sandbox.googleapis.com"];
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		Accept: "application/json",
		"Accept-Encoding": "identity",
		"User-Agent": "antigravity",
	};

	let loadResult: FetchJsonResult<AntigravityLoadCodeAssistResponse> | undefined;
	let baseUrlUsed = baseUrls[0];
	for (const baseUrl of baseUrls) {
		baseUrlUsed = baseUrl;
		loadResult = await fetchJson<AntigravityLoadCodeAssistResponse>(`${baseUrl}/v1internal:loadCodeAssist`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
			}),
		});
		if (loadResult.ok || loadResult.kind === "cancelled" || loadResult.kind === "timeout") break;
	}

	if (!loadResult?.ok)
		return failure(loadResult?.message ?? "Failed to load Code Assist", loadResult?.kind ?? "network");

	const companionProject = loadResult.data.cloudaicompanionProject;
	let projectId = typeof companionProject === "string" ? companionProject : companionProject?.id;
	if (!projectId) {
		for (const key of ["google-antigravity", "antigravity", "google"]) {
			const cred = auth.getCredential(key) as Record<string, unknown> | undefined;
			if (typeof cred?.projectId === "string") {
				projectId = cred.projectId;
				break;
			}
		}
	}

	const modelsResult = await fetchJson<AntigravityFetchAvailableModelsResponse>(
		`${baseUrlUsed}/v1internal:fetchAvailableModels`,
		{ method: "POST", headers, body: JSON.stringify(projectId ? { project: projectId } : {}) },
	);

	if (!modelsResult.ok) return failure(modelsResult.message, modelsResult.kind);
	return success("google-antigravity", parseGoogleAntigravityUsage(loadResult.data, modelsResult.data));
}
