import assert from "node:assert/strict";
import { test } from "node:test";

import { formatExtensionStatuses, formatTopLine } from "./format.ts";

function footerData(statuses = new Map()) {
	return {
		getExtensionStatuses: () => statuses,
		getGitBranch: () => null,
	};
}

function context(cwd) {
	return {
		sessionManager: {
			getCwd: () => cwd,
			getSessionName: () => undefined,
		},
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
