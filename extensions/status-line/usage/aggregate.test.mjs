import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { findSessionFiles, getBillingWindowStartTimes, SessionUsageAggregator } from "./aggregate.ts";

function makeMemoryFs(initialFiles = {}) {
	const files = new Map(Object.entries(initialFiles));
	const dirs = new Set();
	const mtimes = new Map();

	function recordDir(filePath) {
		let cur = path.dirname(filePath);
		while (cur && cur !== "." && cur !== "/") {
			dirs.add(cur);
			cur = path.dirname(cur);
		}
	}

	for (const p of files.keys()) {
		recordDir(p);
		mtimes.set(p, Date.now());
	}

	return {
		existsSync(p) {
			return files.has(p) || dirs.has(p);
		},
		readdirSync(dir, options) {
			const results = [];
			const seen = new Set();
			for (const p of [...files.keys(), ...dirs]) {
				if (path.dirname(p) === dir) {
					const name = path.basename(p);
					if (!seen.has(name)) {
						seen.add(name);
						const isDir = dirs.has(p);
						results.push(options?.withFileTypes ? { name, isDirectory: () => isDir } : name);
					}
				}
			}
			return results;
		},
		readFileSync(p) {
			const content = files.get(p);
			if (content === undefined) throw new Error(`ENOENT: ${p}`);
			return content;
		},
		statSync(p) {
			if (!files.has(p) && !dirs.has(p)) throw new Error(`ENOENT: ${p}`);
			return { mtimeMs: mtimes.get(p) ?? Date.now() };
		},
		writeFile(p, content, mtimeMs = Date.now()) {
			files.set(p, content);
			mtimes.set(p, mtimeMs);
			recordDir(p);
		},
	};
}

test("getBillingWindowStartTimes: computes local day and month boundaries", () => {
	const fixedDate = new Date(2026, 8, 17, 14, 30, 0); // Sep 17, 2026
	const { startOfDay, startOfMonth } = getBillingWindowStartTimes(fixedDate);

	const dayDate = new Date(startOfDay);
	assert.equal(dayDate.getFullYear(), 2026);
	assert.equal(dayDate.getMonth(), 8);
	assert.equal(dayDate.getDate(), 17);
	assert.equal(dayDate.getHours(), 0);
	assert.equal(dayDate.getMinutes(), 0);

	const monthDate = new Date(startOfMonth);
	assert.equal(monthDate.getFullYear(), 2026);
	assert.equal(monthDate.getMonth(), 8);
	assert.equal(monthDate.getDate(), 1);
	assert.equal(monthDate.getHours(), 0);
});

test("findSessionFiles: finds .jsonl files in root and subdirectories in memory", () => {
	const mfs = makeMemoryFs({
		"/sessions/project1/session1.jsonl": "",
		"/sessions/project2/session2.jsonl": "",
		"/sessions/root.jsonl": "",
		"/sessions/project1/ignored.txt": "",
	});

	const files = findSessionFiles("/sessions", mfs);
	assert.equal(files.length, 3);
	assert.ok(files.some((f) => f.endsWith("session1.jsonl")));
	assert.ok(files.some((f) => f.endsWith("session2.jsonl")));
	assert.ok(files.some((f) => f.endsWith("root.jsonl")));
});

test("SessionUsageAggregator: aggregates usage across in-memory files and current session", () => {
	const now = new Date(2026, 8, 17, 12, 0, 0);
	const earlierToday = new Date(2026, 8, 17, 9, 0, 0).toISOString();
	const earlierThisMonth = new Date(2026, 8, 5, 10, 0, 0).toISOString();

	const file1Content = [
		JSON.stringify({ type: "session", id: "s1" }),
		JSON.stringify({
			type: "message",
			timestamp: earlierThisMonth,
			message: {
				role: "assistant",
				provider: "google",
				usage: { input: 1000, output: 500, cost: { total: 0.01 } },
			},
		}),
		JSON.stringify({
			type: "message",
			timestamp: earlierThisMonth,
			message: {
				role: "assistant",
				provider: "anthropic",
				usage: { input: 5000, output: 2000, cost: { total: 0.1 } },
			},
		}),
	].join("\n");

	const file2Content = [
		JSON.stringify({ type: "session", id: "s2" }),
		JSON.stringify({
			type: "message",
			timestamp: earlierToday,
			message: {
				role: "assistant",
				provider: "google",
				usage: { input: 2000, output: 1000, cost: { total: 0.02 } },
			},
		}),
	].join("\n");

	const currentFileContent = [
		JSON.stringify({ type: "session", id: "curr" }),
		JSON.stringify({
			type: "message",
			timestamp: earlierToday,
			message: {
				role: "assistant",
				provider: "google",
				usage: { input: 9999, output: 9999, cost: { total: 9.99 } },
			},
		}),
	].join("\n");

	const mfs = makeMemoryFs({
		"/sessions/sub/session1.jsonl": file1Content,
		"/sessions/sub/session2.jsonl": file2Content,
		"/sessions/sub/current.jsonl": currentFileContent,
	});

	const currentEntries = [
		{
			type: "message",
			timestamp: earlierToday,
			message: {
				role: "assistant",
				usage: { input: 3000, output: 500, cost: { total: 0.015 } },
			},
		},
	];

	const aggregator = new SessionUsageAggregator(mfs);
	const totals = aggregator.getProviderUsage({
		provider: "google",
		sessionsDir: "/sessions",
		currentSessionFile: "/sessions/sub/current.jsonl",
		currentEntries,
		activeModelProvider: "google",
		now,
	});

	// Day tokens: file2 (3000) + currentEntries (3500) = 6500
	assert.equal(totals.day.tokens, 6500);
	assert.equal(Math.round(totals.day.cost * 1000), 35); // 0.02 + 0.015 = 0.035

	// Month tokens: file1 (1500) + file2 (3000) + currentEntries (3500) = 8000
	assert.equal(totals.month.tokens, 8000);
	assert.equal(Math.round(totals.month.cost * 1000), 45); // 0.01 + 0.02 + 0.015 = 0.045
});

test("SessionUsageAggregator: caches results and re-reads on modification in memory", () => {
	const now = new Date(2026, 8, 17, 12, 0, 0);
	const earlierToday = new Date(2026, 8, 17, 9, 0, 0).toISOString();

	const mfs = makeMemoryFs({
		"/sessions/session.jsonl": JSON.stringify({
			type: "message",
			timestamp: earlierToday,
			message: {
				role: "assistant",
				provider: "google",
				usage: { input: 1000, output: 0, cost: { total: 0.01 } },
			},
		}),
	});

	const aggregator = new SessionUsageAggregator(mfs);
	const first = aggregator.getProviderUsage({
		provider: "google",
		sessionsDir: "/sessions",
		now,
	});
	assert.equal(first.day.tokens, 1000);

	// Update in-memory file with new content and newer mtime
	mfs.writeFile(
		"/sessions/session.jsonl",
		[
			JSON.stringify({
				type: "message",
				timestamp: earlierToday,
				message: {
					role: "assistant",
					provider: "google",
					usage: { input: 1000, output: 0, cost: { total: 0.01 } },
				},
			}),
			JSON.stringify({
				type: "message",
				timestamp: earlierToday,
				message: {
					role: "assistant",
					provider: "google",
					usage: { input: 500, output: 0, cost: { total: 0.005 } },
				},
			}),
		].join("\n"),
		Date.now() + 5000,
	);

	const second = aggregator.getProviderUsage({
		provider: "google",
		sessionsDir: "/sessions",
		now,
	});
	assert.equal(second.day.tokens, 1500);
});
