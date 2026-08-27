import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchJson, parseDateish, safePercent } from "./helpers.ts";

test("safePercent: 0/0 returns 0", () => {
	assert.equal(safePercent(0, 0), 0);
});

test("safePercent: NaN inputs return 0", () => {
	assert.equal(safePercent(NaN, 100), 0);
	assert.equal(safePercent(50, NaN), 0);
});

test("safePercent: negative limit returns 0", () => {
	assert.equal(safePercent(10, -5), 0);
});

test("safePercent: 200/100 clamps to 100", () => {
	assert.equal(safePercent(200, 100), 100);
});

test("safePercent: -50/100 clamps to 0", () => {
	assert.equal(safePercent(-50, 100), 0);
});

test("safePercent: normal fraction", () => {
	assert.equal(safePercent(25, 100), 25);
	assert.ok(safePercent(1, 3) > 0 && safePercent(1, 3) <= 100);
});

test("parseDateish: number below 10^11 is treated as seconds", () => {
	const d = parseDateish(1_000_000);
	assert.equal(d.getTime(), 1_000_000_000);
});

test("parseDateish: number above 10^11 is treated as ms", () => {
	const d = parseDateish(2_000_000_000_000);
	assert.equal(d.getTime(), 2_000_000_000_000);
});

test("parseDateish: ISO string", () => {
	const d = parseDateish("2026-01-15T00:00:00Z");
	assert.equal(d.toISOString(), "2026-01-15T00:00:00.000Z");
});

test("parseDateish: undefined returns epoch 0", () => {
	assert.equal(parseDateish(undefined).getTime(), 0);
});

test("fetchJson: 200 with valid JSON returns ok", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		/** @type {Response} */ ({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
			text: async () => "",
		});
	try {
		const result = await fetchJson("https://example.com/api", {});
		assert.equal(result.ok, true);
		assert.deepEqual(result.data, { ok: true });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("fetchJson: 404 returns ok:false with status, kind 'http'", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		/** @type {Response} */ ({
			ok: false,
			status: 404,
			statusText: "Not Found",
			json: async () => ({}),
			text: async () => "",
		});
	try {
		const result = await fetchJson("https://example.com/api", {});
		assert.equal(result.ok, false);
		assert.equal(result.status, 404);
		assert.equal(result.kind, "http");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("fetchJson: network throw maps to kind 'network'", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => {
		throw new Error("net failure");
	};
	try {
		const result = await fetchJson("https://example.com/api", {});
		assert.equal(result.ok, false);
		assert.equal(result.kind, "network");
		assert.equal(result.message, "net failure");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
