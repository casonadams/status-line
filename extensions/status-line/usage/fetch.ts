import type { QuotaAuth } from "./helpers.ts";
import { fetchAnthropicQuotas } from "./providers/anthropic.ts";
import { fetchGitHubCopilotQuotas } from "./providers/github_copilot.ts";
import { fetchGoogleAntigravityQuotas } from "./providers/google_antigravity.ts";
import { fetchOllamaCloudQuotas } from "./providers/ollama_cloud.ts";
import { fetchCodexQuotas } from "./providers/openai_codex.ts";
import type { QuotasResult, SupportedQuotaProvider } from "./types.ts";

const PROVIDER_ALIASES: Record<string, SupportedQuotaProvider> = {
	anthropic: "anthropic",
	codex: "openai-codex",
	"openai-codex": "openai-codex",
	copilot: "github-copilot",
	"github-copilot": "github-copilot",
	google: "google-antigravity",
	antigravity: "google-antigravity",
	"google-antigravity": "google-antigravity",
	"ollama-cloud": "ollama-cloud",
};

export function normalizeProvider(provider: string | undefined, modelId?: string): SupportedQuotaProvider | undefined {
	if (!provider) return undefined;
	const lower = provider.toLowerCase();
	// Local `ollama` (ollama launch pi) shares the Ollama Cloud quota plane,
	// but only cloud models (`:cloud` id suffix) consume it.
	if (lower === "ollama") return modelId?.endsWith(":cloud") ? "ollama-cloud" : undefined;
	return PROVIDER_ALIASES[lower];
}

export function isSupportedProvider(provider: string | undefined, modelId?: string): boolean {
	return normalizeProvider(provider, modelId) !== undefined;
}

const PROVIDER_TTLS_MS: Record<SupportedQuotaProvider, number> = {
	anthropic: 5 * 60_000,
	"openai-codex": 60_000,
	"github-copilot": 5 * 60_000,
	"google-antigravity": 5 * 60_000,
	"ollama-cloud": 5 * 60_000,
};

const BACKOFF_UNIT_MS = 60_000;
const MAX_BACKOFF_MINUTES = 55;

function fibonacciBackoffMinutes(failureCount: number): number {
	if (failureCount <= 2) return 1;
	let previous = 1;
	let current = 1;
	for (let index = 3; index <= failureCount; index++) {
		[previous, current] = [current, previous + current];
		if (current >= MAX_BACKOFF_MINUTES) return MAX_BACKOFF_MINUTES;
	}
	return current;
}

type CacheEntry = {
	result?: QuotasResult;
	fetchedAt?: number;
	failureCount?: number;
	retryAt?: number;
	pending?: Promise<QuotasResult>;
};

export type QuotaCache = {
	get(provider: SupportedQuotaProvider): CacheEntry | undefined;
	set(provider: SupportedQuotaProvider, entry: CacheEntry): void;
};

export function createQuotaCache(): QuotaCache {
	return new Map();
}

const PROVIDER_FETCHERS: Record<SupportedQuotaProvider, (auth: QuotaAuth) => Promise<QuotasResult>> = {
	anthropic: fetchAnthropicQuotas,
	"openai-codex": fetchCodexQuotas,
	"github-copilot": fetchGitHubCopilotQuotas,
	"google-antigravity": fetchGoogleAntigravityQuotas,
	"ollama-cloud": fetchOllamaCloudQuotas,
};

export async function fetchProviderQuotas(
	auth: QuotaAuth,
	rawProvider: string,
	cache: QuotaCache,
): Promise<QuotasResult> {
	const provider = normalizeProvider(rawProvider, auth.modelId);
	if (!provider) {
		return { success: false, error: { message: `Unsupported provider: ${rawProvider}`, kind: "config" } };
	}

	const entry = cache.get(provider) ?? {};
	const now = Date.now();
	const ttl = PROVIDER_TTLS_MS[provider];

	if (entry.result?.success && entry.fetchedAt && now - entry.fetchedAt < ttl) {
		return entry.result;
	}
	if (entry.result && !entry.result.success && entry.retryAt && now < entry.retryAt) {
		return entry.result;
	}
	if (entry.pending) return entry.pending;

	const pending = PROVIDER_FETCHERS[provider](auth);
	cache.set(provider, { ...entry, pending });
	let result: QuotasResult;
	try {
		result = await pending;
	} catch (error) {
		cache.set(provider, entry);
		throw error;
	}
	const fetchedAt = Date.now();
	if (result.success) {
		cache.set(provider, { result, fetchedAt, failureCount: 0 });
	} else {
		const failureCount = (entry.failureCount ?? 0) + 1;
		const backoffMinutes = fibonacciBackoffMinutes(failureCount);
		cache.set(provider, {
			result,
			fetchedAt,
			failureCount,
			retryAt: fetchedAt + backoffMinutes * BACKOFF_UNIT_MS,
		});
	}
	return result;
}
