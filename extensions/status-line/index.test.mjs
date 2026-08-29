import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers";

import installStatusLine from "./index.ts";

function stubEmptyAgentDir() {
	const original = process.env.PI_CODING_AGENT_DIR;
	const dir = mkdtempSync(join(tmpdir(), "status-line-test-agent-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	return () => {
		rmSync(dir, { recursive: true, force: true });
		if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = original;
	};
}

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
			notify: () => {},
			setFooter: () => {},
			setStatus: (_key, status) => statuses.push(status),
		},
	};
}

function makeExtensionApi(handlers) {
	return {
		on: (event, handler) => handlers.set(event, handler),
		registerCommand: () => {},
	};
}

test("status command toggles extension status visibility", () => {
	const handlers = new Map();
	let command;
	installStatusLine({
		on: (event, handler) => handlers.set(event, handler),
		registerCommand: (name, options) => {
			if (name === "status-line.statuses") command = options;
		},
	});
	const notifications = [];
	let footerUpdates = 0;
	const ctx = makeContext(undefined, []);
	ctx.ui.notify = (message) => notifications.push(message);
	ctx.ui.setFooter = () => footerUpdates++;

	command.handler("", ctx);
	command.handler("", ctx);

	assert.equal(footerUpdates, 2);
	assert.deepEqual(notifications, ["Extension statuses shown", "Extension statuses hidden"]);
});

test("a completed refresh cannot restore status after shutdown", async () => {
	const handlers = new Map();
	installStatusLine(makeExtensionApi(handlers));
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
	installStatusLine(makeExtensionApi(handlers));
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

test("ollama-cloud model renders remaining session and weekly percentages", async () => {
	const handlers = new Map();
	installStatusLine(makeExtensionApi(handlers));
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = async () => {
		fetchCalls++;
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	const statuses = [];
	try {
		handlers.get("session_start")({}, makeContext("ollama-cloud", statuses));
		handlers.get("turn_end")({}, makeContext("ollama-cloud", statuses));
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(statuses.at(-1), "66% 55%");
		assert.equal(fetchCalls, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("ollama-cloud model at cap renders the limited marker", async () => {
	const handlers = new Map();
	installStatusLine(makeExtensionApi(handlers));
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		/** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 1.0 }, weekly: { usage: 1.0 } } }),
			text: async () => "",
		});
	const statuses = [];
	try {
		handlers.get("turn_end")({}, makeContext("ollama-cloud", statuses));
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(statuses.at(-1), "0% ! 0% !");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("ollama-cloud without any key degrades to the warning status without HTTP calls", async () => {
	const handlers = new Map();
	installStatusLine(makeExtensionApi(handlers));
	const originalFetch = globalThis.fetch;
	const originalEnv = process.env.OLLAMA_API_KEY;
	delete process.env.OLLAMA_API_KEY;
	let fetchCalls = 0;
	globalThis.fetch = async () => {
		fetchCalls++;
		throw new Error("must not fetch without a key");
	};
	const statuses = [];
	const restoreAgentDir = stubEmptyAgentDir();
	try {
		const context = makeContext("ollama-cloud", statuses);
		context.modelRegistry.getApiKeyForProvider = async () => undefined;
		handlers.get("turn_end")({}, context);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(statuses.at(-1), "quota fetch failed (ollama-cloud)");
		assert.equal(fetchCalls, 0);
	} finally {
		restoreAgentDir();
		globalThis.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.OLLAMA_API_KEY;
		else process.env.OLLAMA_API_KEY = originalEnv;
	}
});

test("unsupported local ollama provider never fetches or sets a status", async () => {
	const handlers = new Map();
	installStatusLine(makeExtensionApi(handlers));
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = async () => {
		fetchCalls++;
		throw new Error("must not fetch for an unsupported provider");
	};
	const statuses = [];
	try {
		handlers.get("model_select")({}, makeContext("ollama", statuses));
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(statuses.at(-1), undefined);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("local ollama cloud model renders ollama usage like the ollama-cloud provider", async () => {
	const handlers = new Map();
	installStatusLine(makeExtensionApi(handlers));
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = async () => {
		fetchCalls++;
		return /** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ limits: { session: { usage: 0.34 }, weekly: { usage: 0.45 } } }),
			text: async () => "",
		});
	};
	const statuses = [];
	try {
		const context = makeContext("ollama", statuses);
		context.model.id = "glm-5.3-flash:cloud";
		handlers.get("turn_end")({}, context);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(statuses.at(-1), "66% 55%");
		assert.equal(fetchCalls, 1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("local ollama cloud model without any key shows the warning status without HTTP calls", async () => {
	const handlers = new Map();
	installStatusLine(makeExtensionApi(handlers));
	const originalFetch = globalThis.fetch;
	const originalEnv = process.env.OLLAMA_API_KEY;
	delete process.env.OLLAMA_API_KEY;
	let fetchCalls = 0;
	globalThis.fetch = async () => {
		fetchCalls++;
		throw new Error("must not fetch without a key");
	};
	const statuses = [];
	const restoreAgentDir = stubEmptyAgentDir();
	try {
		const context = makeContext("ollama", statuses);
		context.model.id = "glm-5.3-flash:cloud";
		context.modelRegistry.getApiKeyForProvider = async () => undefined;
		handlers.get("turn_end")({}, context);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(statuses.at(-1), "quota fetch failed (ollama-cloud)");
		assert.equal(fetchCalls, 0);
	} finally {
		restoreAgentDir();
		globalThis.fetch = originalFetch;
		if (originalEnv === undefined) delete process.env.OLLAMA_API_KEY;
		else process.env.OLLAMA_API_KEY = originalEnv;
	}
});
