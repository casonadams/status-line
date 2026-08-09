import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchProviderQuotas, isSupportedProvider } from "./fetch.ts";
import { fetchAnthropicQuotas } from "./providers/anthropic.ts";
import { fetchGitHubCopilotQuotas } from "./providers/github_copilot.ts";
import { fetchGoogleAntigravityQuotas } from "./providers/google_antigravity.ts";
import { fetchCodexQuotas } from "./providers/openai_codex.ts";

function makeAuth(overrides = {}) {
	return {
		getApiKey: async (provider) => (provider === overrides.tokenProvider ? "token" : undefined),
		getCredential: (key) => overrides[key],
	};
}

function makeCache() {
	const store = new Map();
	return {
		get(provider) {
			return store.get(provider);
		},
		set(provider, entry) {
			store.set(provider, entry);
		},
	};
}

// ── isSupportedProvider ─────────────────────────────────────────────────────

test("isSupportedProvider: known providers", () => {
	assert.equal(isSupportedProvider("anthropic"), true);
	assert.equal(isSupportedProvider("openai-codex"), true);
	assert.equal(isSupportedProvider("github-copilot"), true);
	assert.equal(isSupportedProvider("google-antigravity"), true);
});

test("isSupportedProvider: unknown and undefined are false", () => {
	assert.equal(isSupportedProvider("ollama"), false);
	assert.equal(isSupportedProvider(undefined), false);
});

// ── fetchProviderQuotas cache ───────────────────────────────────────────────

test("cache: first call hits the network, second call within TTL returns cached result", async () => {
	let calls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		calls++;
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({
				five_hour: { utilization: 10, resets_at: "2026-01-01T00:00:00Z" },
			}),
			text: async () => "",
		});
	};
	try {
		const auth = makeAuth({ tokenProvider: "anthropic" });
		const cache = makeCache();
		const first = await fetchProviderQuotas(auth, "anthropic", cache);
		assert.equal(first.success, true);
		const second = await fetchProviderQuotas(auth, "anthropic", cache);
		assert.equal(second.success, true);
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("cache: concurrent calls share one in-flight provider request", async () => {
	let calls = 0;
	let resolveFetch;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () => {
		calls++;
		return new Promise((resolve) => {
			resolveFetch = resolve;
		});
	};
	try {
		const auth = makeAuth({ tokenProvider: "anthropic" });
		const cache = makeCache();
		const first = fetchProviderQuotas(auth, "anthropic", cache);
		const second = fetchProviderQuotas(auth, "anthropic", cache);
		await Promise.resolve();
		assert.equal(calls, 1);
		resolveFetch({
			ok: true,
			status: 200,
			json: async () => ({}),
			text: async () => "",
		});
		assert.equal((await first).success, true);
		assert.equal((await second).success, true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("cache: missing token still caches the failure", async () => {
	let calls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		calls++;
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({}),
			text: async () => "",
		});
	};
	try {
		const auth = makeAuth();
		const cache = makeCache();
		const first = await fetchProviderQuotas(auth, "openai-codex", cache);
		assert.equal(first.success, false);
		const second = await fetchProviderQuotas(auth, "openai-codex", cache);
		assert.equal(second.success, false);
		assert.equal(calls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("cache: failures use Fibonacci-minute backoff", async () => {
	const originalNow = Date.now;
	let now = 1_000_000;
	let attempts = 0;
	Date.now = () => now;
	const auth = {
		getApiKey: async () => {
			attempts++;
			return undefined;
		},
		getCredential: () => undefined,
	};
	const cache = makeCache();
	try {
		await fetchProviderQuotas(auth, "anthropic", cache); // retry in 1m
		now += 60_000;
		await fetchProviderQuotas(auth, "anthropic", cache); // retry in 1m
		now += 60_000;
		await fetchProviderQuotas(auth, "anthropic", cache); // retry in 2m
		now += 60_000;
		await fetchProviderQuotas(auth, "anthropic", cache); // still backed off
		assert.equal(attempts, 3);
		now += 60_000;
		await fetchProviderQuotas(auth, "anthropic", cache);
		assert.equal(attempts, 4);
	} finally {
		Date.now = originalNow;
	}
});

// ── provider fetchers ─────────────────────────────────────────────────────

test("anthropic: hits the oauth/usage endpoint with bearer + beta header", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({}),
			text: async () => "",
		});
	};
	try {
		const auth = makeAuth({ tokenProvider: "anthropic" });
		await fetchAnthropicQuotas(auth);
		assert.equal(captured.url, "https://api.anthropic.com/api/oauth/usage");
		assert.equal(captured.init.headers["anthropic-beta"], "oauth-2025-04-20");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("openai-codex: hits chatgpt backend with ChatGPT-Account-Id header", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({}),
			text: async () => "",
		});
	};
	try {
		const auth = makeAuth({
			tokenProvider: "openai-codex",
			"openai-codex": { accountId: "acc-123" },
		});
		await fetchCodexQuotas(auth);
		assert.equal(captured.url, "https://chatgpt.com/backend-api/wham/usage");
		assert.equal(captured.init.headers["ChatGPT-Account-Id"], "acc-123");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("openai-codex: missing accountId returns config error", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		/** @type {Response} */ ({
			ok: false,
			status: 500,
			statusText: "nope",
			json: async () => ({}),
			text: async () => "",
		});
	try {
		const auth = makeAuth({ tokenProvider: "openai-codex" });
		const result = await fetchCodexQuotas(auth);
		assert.equal(result.success, false);
		assert.equal(result.error.kind, "config");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("github-copilot: hits copilot_internal/user with plugin headers", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({}),
			text: async () => "",
		});
	};
	try {
		const auth = makeAuth({ tokenProvider: "github-copilot" });
		await fetchGitHubCopilotQuotas(auth);
		assert.equal(captured.url, "https://api.github.com/copilot_internal/user");
		assert.equal(captured.init.headers["Copilot-Integration-Id"], "vscode-chat");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("github-copilot: preserves request errors after credential fallbacks fail", async () => {
	const originalFetch = globalThis.fetch;
	const originalPath = process.env.PATH;
	process.env.PATH = "";
	globalThis.fetch = async () =>
		/** @type {Response} */ ({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			json: async () => ({}),
			text: async () => "Unauthorized",
		});
	try {
		const auth = makeAuth({ "github-copilot": { type: "oauth", refresh: "bad-token" } });
		const result = await fetchGitHubCopilotQuotas(auth);
		assert.equal(result.success, false);
		assert.equal(result.error.kind, "http");
		assert.equal(result.error.message, "Unauthorized");
	} finally {
		globalThis.fetch = originalFetch;
		process.env.PATH = originalPath;
	}
});

test("github-copilot: no credentials returns config error", async () => {
	const originalPath = process.env.PATH;
	process.env.PATH = "";
	try {
		const auth = makeAuth();
		const result = await fetchGitHubCopilotQuotas(auth);
		assert.equal(result.success, false);
		assert.equal(result.error.kind, "config");
	} finally {
		process.env.PATH = originalPath;
	}
});

test("google-antigravity: missing token returns config error", async () => {
	const auth = makeAuth();
	const result = await fetchGoogleAntigravityQuotas(auth);
	assert.equal(result.success, false);
	assert.equal(result.error.kind, "config");
});

test("google-antigravity: decodes provider API key and fetches usage endpoints", async () => {
	const originalFetch = globalThis.fetch;
	const requests = [];
	globalThis.fetch = async (url, init) => {
		requests.push({ url, init });
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({
				groups: [{ buckets: [{ bucketId: "claude-sonnet-4-6", remainingFraction: 0.2 }] }],
			}),
			text: async () => "",
		});
	};
	try {
		const auth = {
			modelId: "claude-sonnet-4-6",
			getApiKey: async (provider) =>
				provider === "antigravity" ? JSON.stringify({ token: "access-token", projectId: "proj-123" }) : undefined,
			getCredential: () => undefined,
		};
		const result = await fetchGoogleAntigravityQuotas(auth);
		assert.equal(result.success, true);
		assert.equal(result.data.windows[0].usedPercent, 80);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].url, "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary");
		assert.equal(requests[0].init.headers.Authorization, "Bearer access-token");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
