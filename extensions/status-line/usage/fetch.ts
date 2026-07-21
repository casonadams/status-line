import type { QuotaAuth } from "./helpers.ts";
import { fetchAnthropicQuotas } from "./providers/anthropic.ts";
import { fetchGitHubCopilotQuotas } from "./providers/github_copilot.ts";
import { fetchCodexQuotas } from "./providers/openai_codex.ts";
import type { QuotasResult, SupportedQuotaProvider } from "./types.ts";

export const SUPPORTED_PROVIDERS: SupportedQuotaProvider[] = ["anthropic", "openai-codex", "github-copilot"];

export function isSupportedProvider(provider: string | undefined): provider is SupportedQuotaProvider {
	return SUPPORTED_PROVIDERS.includes(provider as SupportedQuotaProvider);
}

const PROVIDER_TTLS_MS: Record<SupportedQuotaProvider, number> = {
	anthropic: 5 * 60_000,
	"openai-codex": 60_000,
	"github-copilot": 5 * 60_000,
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
};

export async function fetchProviderQuotas(
	auth: QuotaAuth,
	provider: SupportedQuotaProvider,
	cache: QuotaCache,
): Promise<QuotasResult> {
	const entry = cache.get(provider) ?? {};
	const now = Date.now();
	const ttl = PROVIDER_TTLS_MS[provider];

	if (entry.result?.success && entry.fetchedAt && now - entry.fetchedAt < ttl) {
		return entry.result;
	}
	if (entry.result && !entry.result.success && entry.retryAt && now < entry.retryAt) {
		return entry.result;
	}

	const result = await PROVIDER_FETCHERS[provider](auth);
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
