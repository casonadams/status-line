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
// The credential may live under either provider id: ollama-cloud (the
// pi-ollama-cloud provider) or ollama (pi's local provider id).
const OLLAMA_PROVIDER_IDS = ["ollama-cloud", "ollama"] as const;

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function credentialField(credential: unknown, field: string): string | undefined {
	if (credential == null || typeof credential !== "object" || Array.isArray(credential)) return undefined;
	const value = (credential as Record<string, unknown>)[field];
	return isNonEmptyString(value) ? value : undefined;
}

// Canonical spelling is static_key; the hyphenated form is tolerated.
function pinnedCredentialKey(credential: unknown): string | undefined {
	return credentialField(credential, "static_key") ?? credentialField(credential, "static-key");
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

// static_key is a user-pinned override: it beats every tool-managed source
// (registry keys and the entry's own `key` field, which ollama/pi may rewrite).
async function resolveOllamaApiKey(auth: QuotaAuth): Promise<string | undefined> {
	for (const id of OLLAMA_PROVIDER_IDS) {
		const pinned = pinnedCredentialKey(auth.getCredential(id));
		if (pinned) return pinned;
	}
	for (const id of OLLAMA_PROVIDER_IDS) {
		const registryKey = await auth.getApiKey(id);
		if (registryKey) return registryKey;
	}
	for (const id of OLLAMA_PROVIDER_IDS) {
		const stored = credentialField(auth.getCredential(id), "key");
		if (stored) return stored;
	}
	return process.env[OLLAMA_API_KEY_ENV];
}

// The /api/usage endpoint is undocumented and may change or disappear without notice.
export async function fetchOllamaCloudQuotas(auth: QuotaAuth): Promise<QuotasResult> {
	const apiKey = await resolveOllamaApiKey(auth);
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
