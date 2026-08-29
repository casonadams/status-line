import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchProviderQuotas, isSupportedProvider, normalizeProvider } from "./fetch.ts";
import { fetchAnthropicQuotas } from "./providers/anthropic.ts";
import { fetchGitHubCopilotQuotas } from "./providers/github_copilot.ts";
import { fetchGoogleAntigravityQuotas } from "./providers/google_antigravity.ts";
import { fetchOllamaCloudQuotas } from "./providers/ollama_cloud.ts";
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
		await fetchProviderQuotas(auth, "anthropic", cache);
		now += 60_000;
		await fetchProviderQuotas(auth, "anthropic", cache);
		now += 60_000;
		await fetchProviderQuotas(auth, "anthropic", cache);
		now += 60_000;
		await fetchProviderQuotas(auth, "anthropic", cache);
		assert.equal(attempts, 3);
		now += 60_000;
		await fetchProviderQuotas(auth, "anthropic", cache);
		assert.equal(attempts, 4);
	} finally {
		Date.now = originalNow;
	}
});

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
				models: { "claude-sonnet-4-6": { quotaInfo: { remainingFraction: 0.2 } } },
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
		assert.equal(requests[0].url, "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels");
		assert.equal(requests[0].init.headers.Authorization, "Bearer access-token");
		assert.deepEqual(JSON.parse(requests[0].init.body), { project: "proj-123" });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("isSupportedProvider: ollama-cloud is supported in any casing", () => {
	assert.equal(isSupportedProvider("ollama-cloud"), true);
	assert.equal(isSupportedProvider("OLLAMA-Cloud"), true);
});

test("ollama-cloud: hits the api/usage endpoint with bearer auth", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	try {
		const auth = makeAuth({ tokenProvider: "ollama-cloud" });
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, true);
		assert.equal(captured.url, "https://ollama.com/api/usage");
		assert.equal(captured.init.headers.Authorization, "Bearer token");
		assert.equal(result.data.provider, "ollama-cloud");
		assert.deepEqual(
			result.data.windows.map((w) => [w.label, w.usedPercent]),
			[
				["5h", 34],
				["7d", 45],
			],
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("ollama-cloud: no key returns config failure without any HTTP call", async () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = process.env.OLLAMA_API_KEY;
	delete process.env.OLLAMA_API_KEY;
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		throw new Error("must not fetch without a key");
	};
	try {
		const auth = makeAuth();
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, false);
		assert.equal(result.error.kind, "config");
		assert.equal(calls, 0);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.OLLAMA_API_KEY;
		else process.env.OLLAMA_API_KEY = originalEnv;
	}
});

test("ollama-cloud: falls back to OLLAMA_API_KEY when the registry misses", async () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = process.env.OLLAMA_API_KEY;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	process.env.OLLAMA_API_KEY = "env-fallback-key";
	try {
		const auth = makeAuth();
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, true);
		assert.equal(captured.init.headers.Authorization, "Bearer env-fallback-key");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.OLLAMA_API_KEY;
		else process.env.OLLAMA_API_KEY = originalEnv;
	}
});

test("ollama-cloud: unexpected response shape returns an http failure", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		/** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 } } }),
			text: async () => "",
		});
	try {
		const auth = makeAuth({ tokenProvider: "ollama-cloud" });
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, false);
		assert.equal(result.error.kind, "http");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("ollama-cloud: malformed JSON body keeps the network classification", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		/** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => {
				throw new Error("malformed body");
			},
			text: async () => "",
		});
	try {
		const auth = makeAuth({ tokenProvider: "ollama-cloud" });
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, false);
		assert.equal(result.error.kind, "network");
		assert.equal(result.error.message, "malformed body");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("ollama-cloud: non-ok status preserves the http kind and message", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		/** @type {Response} */ ({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
			json: async () => ({}),
			text: async () => "Unauthorized",
		});
	try {
		const auth = makeAuth({ tokenProvider: "ollama-cloud" });
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, false);
		assert.equal(result.error.kind, "http");
		assert.equal(result.error.message, "Unauthorized");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("cache: ollama-cloud within the 5-minute TTL returns the cached result", async () => {
	let calls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		calls++;
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	try {
		const auth = makeAuth({ tokenProvider: "ollama-cloud" });
		const cache = makeCache();
		const first = await fetchProviderQuotas(auth, "ollama-cloud", cache);
		assert.equal(first.success, true);
		const second = await fetchProviderQuotas(auth, "ollama-cloud", cache);
		assert.equal(second.success, true);
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("cache: ollama-cloud config failure is cached with zero further HTTP calls", async () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = process.env.OLLAMA_API_KEY;
	delete process.env.OLLAMA_API_KEY;
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		throw new Error("must not fetch without a key");
	};
	try {
		const auth = makeAuth();
		const cache = makeCache();
		const first = await fetchProviderQuotas(auth, "ollama-cloud", cache);
		assert.equal(first.success, false);
		const second = await fetchProviderQuotas(auth, "ollama-cloud", cache);
		assert.equal(second.success, false);
		assert.equal(calls, 0);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.OLLAMA_API_KEY;
		else process.env.OLLAMA_API_KEY = originalEnv;
	}
});

test("normalizeProvider: local ollama resolves only for cloud models", () => {
	assert.equal(normalizeProvider("ollama", "glm-5.3-flash:cloud"), "ollama-cloud");
	assert.equal(normalizeProvider("OLLAMA", "glm-5.3-flash:cloud"), "ollama-cloud");
	assert.equal(normalizeProvider("ollama", "llama3:8b"), undefined);
	assert.equal(normalizeProvider("ollama", undefined), undefined);
	assert.equal(normalizeProvider("ollama-cloud", undefined), "ollama-cloud");
	assert.equal(normalizeProvider("ollama-cloud", "glm-5.3-flash"), "ollama-cloud");
});

test("ollama: fetches with the auth.json ollama-cloud credential when the registry misses", async () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = process.env.OLLAMA_API_KEY;
	delete process.env.OLLAMA_API_KEY;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	try {
		const auth = {
			modelId: "glm-5.3-flash:cloud",
			getApiKey: async () => undefined,
			getCredential: (id) => (id === "ollama-cloud" ? { type: "api_key", key: "cred-key" } : undefined),
		};
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, true);
		assert.equal(captured.init.headers.Authorization, "Bearer cred-key");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.OLLAMA_API_KEY;
		else process.env.OLLAMA_API_KEY = originalEnv;
	}
});

test("ollama: accepts the credential stored under the local ollama provider id", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	try {
		const auth = {
			modelId: "glm-5.3-flash:cloud",
			getApiKey: async (id) => (id === "ollama" ? "local-registry-key" : undefined),
			getCredential: () => undefined,
		};
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, true);
		assert.equal(captured.init.headers.Authorization, "Bearer local-registry-key");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("ollama: falls back to the ollama-id credential when both registry lookups miss", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	try {
		const auth = {
			modelId: "glm-5.3-flash:cloud",
			getApiKey: async () => undefined,
			getCredential: (id) => (id === "ollama" ? { type: "api_key", key: "local-cred-key" } : undefined),
		};
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, true);
		assert.equal(captured.init.headers.Authorization, "Bearer local-cred-key");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("ollama: a pinned static_key beats the tool-managed registry and entry key", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	try {
		const auth = {
			modelId: "glm-5.3-flash:cloud",
			getApiKey: async () => "device-key",
			getCredential: () => ({ type: "api_key", key: "device-key", static_key: "pinned-key" }),
		};
		const result = await fetchOllamaCloudQuotas(auth);
		assert.equal(result.success, true);
		assert.equal(captured.init.headers.Authorization, "Bearer pinned-key");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("fetchProviderQuotas: raw local ollama with a cloud model shares the ollama-cloud cache plane", async () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = process.env.OLLAMA_API_KEY;
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	try {
		const auth = {
			modelId: "glm-5.3-flash:cloud",
			getApiKey: async () => undefined,
			getCredential: () => undefined,
		};
		process.env.OLLAMA_API_KEY = "env-fallback-key";
		const cache = makeCache();
		const first = await fetchProviderQuotas(auth, "ollama", cache);
		assert.equal(first.success, true);
		const second = await fetchProviderQuotas(auth, "ollama", cache);
		assert.equal(second.success, true);
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.OLLAMA_API_KEY;
		else process.env.OLLAMA_API_KEY = originalEnv;
	}
});

test("fetchProviderQuotas: raw local ollama with a non-cloud model never reaches the network", async () => {
	let calls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		calls++;
		throw new Error("must not fetch for a non-cloud model");
	};
	try {
		const auth = {
			modelId: "llama3:8b",
			getApiKey: async () => undefined,
			getCredential: () => undefined,
		};
		const result = await fetchProviderQuotas(auth, "ollama", makeCache());
		assert.equal(result.success, false);
		assert.equal(result.error.kind, "config");
		assert.equal(calls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
