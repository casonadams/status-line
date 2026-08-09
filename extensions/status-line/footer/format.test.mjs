import assert from "node:assert/strict";
import { test } from "node:test";

import { formatExtensionStatuses, formatStatsLine, formatTopLine } from "./format.ts";

function footerData(statuses = new Map()) {
	return {
		getExtensionStatuses: () => statuses,
		getGitBranch: () => null,
	};
}

function context(cwd) {
	return {
		model: { id: "test-model", contextWindow: 1000, reasoning: true },
		modelRegistry: { isUsingOAuth: () => false },
		sessionManager: {
			getCwd: () => cwd,
			getSessionName: () => undefined,
			getEntries: () => [{ type: "thinking_level_change", thinkingLevel: "medium" }],
		},
		getContextUsage: () => ({ percent: 10, contextWindow: 1000 }),
		ui: { theme: { fg: (_color, text) => text } },
	};
}

test("quota status appears before model and thinking level on the stats line", () => {
	const data = footerData(
		new Map([
			["status-line", "25% 4h30m"],
			["second", "second status"],
		]),
	);

	assert.equal(formatTopLine(context("/work"), data, 80), "/work");
	assert.equal(formatStatsLine(context("/work"), data, 80).trimEnd().endsWith("25% 4h30m • test-model • medium"), true);
	assert.equal(formatExtensionStatuses(data, 80), "second status");
});

test("formatTopLine abbreviates only true descendants of the home directory", () => {
	const originalHome = process.env.HOME;
	process.env.HOME = "/Users/alice";
	try {
		assert.equal(formatTopLine(context("/Users/alice/project"), footerData(), 80), "~/project");
		assert.equal(formatTopLine(context("/Users/alice-work/project"), footerData(), 80), "/Users/alice-work/project");
	} finally {
		process.env.HOME = originalHome;
	}
});
