import assert from "node:assert/strict";
import { test } from "node:test";

import { formatExtensionStatuses, formatStatsLine, formatTopLine } from "./format.ts";

function footerData(statuses = new Map()) {
	return {
		getAvailableProviderCount: () => 2,
		getExtensionStatuses: () => statuses,
		getGitBranch: () => null,
	};
}

function context(cwd) {
	return {
		model: { provider: "test-provider", id: "test-model", contextWindow: 1000, reasoning: true },
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

test("formatExtensionStatuses excludes the status shown on the top line", () => {
	const data = footerData(
		new Map([
			["first", "first status"],
			["second", "second status"],
		]),
	);

	assert.equal(formatTopLine(context("/work"), data, 80).trimEnd().endsWith("first status"), true);
	assert.equal(formatExtensionStatuses(data, 80), "second status");
});

test("formatStatsLine shows provider when multiple providers are available and space permits", () => {
	const data = footerData();
	assert.equal(
		formatStatsLine(context("/work"), data, 80).trimEnd().endsWith("(test-provider) test-model • medium"),
		true,
	);
	assert.equal(formatStatsLine(context("/work"), data, 35).includes("test-provider"), false);
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
