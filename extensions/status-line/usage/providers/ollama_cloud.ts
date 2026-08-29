import { failure, fetchJson, type QuotaAuth, success } from "../helpers.ts";
import type { QuotasResult, QuotaWindow } from "../types.ts";

interface OllamaUsageResponse {
	limits?: {
		session?: { usage?: unknown };
		weekly?: { usage?: unknown };
	};
}

const OLLAMA_USAGE_URL = "https://ollama.com/api/usage";
const OLLAMA_API_KEY_ENV = "OLLAMA_API_KEY";

/** Extract the key from an auth.json credential entry ({"type": "api_key", "key": ...}). */
function credentialApiKey(credential: unknown): string | undefined {
	if (credential == null || typeof credential !== "object" || Array.isArray(credential)) return undefined;
	const entry = credential as { type?: unknown; key?: unknown };
	if (entry.type !== "api_key" || typeof entry.key !== "string" || entry.key.length === 0) return undefined;
	return entry.key;
}

export function parseOllamaUsage(data: unknown): QuotaWindow[] {
	const session = usageFraction(data, "session");
	const weekly = usageFraction(data, "weekly");
	if (session === undefined || weekly === undefined) return [];
	return [quotaWindow("5h", session), quotaWindow("7d", weekly)];
}

function usageFraction(data: unknown, key: "session" | "weekly"): number | undefined {
	if (data == null || typeof data !== "object" || Array.isArray(data)) return undefined;
	const limit = (data as { limits?: Record<string, unknown> }).limits?.[key];
	if (limit == null || typeof limit !== "object") return undefined;
	const usage = (limit as { usage?: unknown }).usage;
	if (typeof usage !== "number" || !Number.isFinite(usage)) return undefined;
	return usage;
}

function quotaWindow(label: string, fraction: number): QuotaWindow {
	const usedPercent = Math.min(100, Math.max(0, Math.round(fraction * 100)));
	return { label, usedPercent, usedValue: usedPercent, limitValue: 100, limited: fraction >= 1 };
}

// The /api/usage endpoint is undocumented and may change or disappear without notice.
export async function fetchOllamaCloudQuotas(auth: QuotaAuth): Promise<QuotasResult> {
	const apiKey =
		(await auth.getApiKey("ollama-cloud")) ??
		credentialApiKey(auth.getCredential("ollama-cloud")) ??
		process.env[OLLAMA_API_KEY_ENV];
	if (!apiKey) return failure("No Ollama Cloud API key found", "config");
	const result = await fetchJson<OllamaUsageResponse>(OLLAMA_USAGE_URL, {
		method: "GET",
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!result.ok) return failure(result.message, result.kind);
	const windows = parseOllamaUsage(result.data);
	if (windows.length === 0) return failure("Unexpected response shape from Ollama Cloud usage", "http");
	return success("ollama-cloud", windows);
}
