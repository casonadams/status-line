import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers";

import installStatusLine from "./index.ts";

function deferred() {
	let resolve;
	const promise = new Promise((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

function makeContext(provider, statuses) {
	return {
		hasUI: true,
		model: provider ? { provider } : undefined,
		modelRegistry: {
			getApiKeyForProvider: async () => "token",
		},
		ui: {
			theme: { fg: (_color, text) => text },
			setFooter: () => {},
			setStatus: (_key, status) => statuses.push(status),
		},
	};
}

test("a completed refresh cannot restore status after shutdown", async () => {
	const handlers = new Map();
	installStatusLine({ on: (event, handler) => handlers.set(event, handler) });
	const response = deferred();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () => response.promise;
	const statuses = [];
	const context = makeContext("anthropic", statuses);
	try {
		handlers.get("session_start")({}, context);
		handlers.get("session_shutdown")({}, context);

		response.resolve({
			ok: true,
			status: 200,
			json: async () => ({ five_hour: { utilization: 25 } }),
			text: async () => "",
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(statuses, [undefined]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("a completed refresh cannot restore status after switching to an unsupported provider", async () => {
	const handlers = new Map();
	installStatusLine({ on: (event, handler) => handlers.set(event, handler) });
	const response = deferred();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () => response.promise;
	const statuses = [];
	try {
		handlers.get("session_start")({}, makeContext("anthropic", statuses));
		handlers.get("model_select")({}, makeContext("ollama", statuses));
		assert.equal(statuses.at(-1), undefined);

		response.resolve({
			ok: true,
			status: 200,
			json: async () => ({ five_hour: { utilization: 25 } }),
			text: async () => "",
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(statuses, [undefined]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
