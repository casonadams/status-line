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

test("formatStatsLine indicates hidden extension statuses", () => {
	const data = footerData(
		new Map([
			["status-line", "25% 4h30m"],
			["mcp", "MCP: 2 servers enabled"],
		]),
	);

	assert.equal(formatTopLine(context("/work"), data, { width: 80 }).trimEnd().endsWith("25% 4h30m"), true);
	assert.equal(
		formatStatsLine(context("/work"), data, { width: 80 }).trimEnd().endsWith("1 • test-model • medium"),
		true,
	);
	assert.equal(
		formatStatsLine(context("/work"), data, { width: 80, showExtensionStatuses: true })
			.trimEnd()
			.endsWith("test-model • medium"),
		true,
	);
	assert.equal(formatExtensionStatuses(data, 80), "MCP: 2 servers enabled");
});

test("formatStatsLine omits the provider", () => {
	const line = formatStatsLine(context("/work"), footerData(), { width: 80 });
	assert.equal(line.trimEnd().endsWith("test-model • medium"), true);
	assert.equal(line.includes("test-provider"), false);
});

test("formatTopLine abbreviates only true descendants of the home directory", () => {
	const originalHome = process.env.HOME;
	process.env.HOME = "/Users/alice";
	try {
		assert.equal(formatTopLine(context("/Users/alice/project"), footerData(), { width: 80 }), "~/project");
		assert.equal(
			formatTopLine(context("/Users/alice-work/project"), footerData(), { width: 80 }),
			"/Users/alice-work/project",
		);
	} finally {
		process.env.HOME = originalHome;
	}
});
