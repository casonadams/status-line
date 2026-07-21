import assert from "node:assert/strict";
import { test } from "node:test";

import { formatQuotaCountdown, formatStatusLineQuotaStatus } from "./format.ts";

const base = (overrides) => ({
	provider: "anthropic",
	label: "5h",
	usedPercent: 50,
	resetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
	windowSeconds: 5 * 60 * 60,
	usedValue: 50,
	limitValue: 100,
	...overrides,
});

test("formatStatusLineQuotaStatus: empty windows returns undefined", () => {
	assert.equal(formatStatusLineQuotaStatus([]), undefined);
});

test("formatStatusLineQuotaStatus: percent-only window", () => {
	const text = formatStatusLineQuotaStatus([base({ usedPercent: 30, resetsAt: new Date(0) })]);
	assert.equal(text, "70%");
});

test("formatStatusLineQuotaStatus: unlimited window", () => {
	const text = formatStatusLineQuotaStatus([base({ label: "Unlimited", unlimited: true, resetsAt: new Date(0) })]);
	assert.equal(text, "unlimited");
});

test("formatStatusLineQuotaStatus: credit balance", () => {
	const text = formatStatusLineQuotaStatus([
		base({
			provider: "openai-codex",
			label: "Credits",
			usedValue: 12.34,
			limitValue: 12.34,
			isCurrency: true,
			usedPercent: 0,
			resetsAt: new Date(0),
		}),
	]);
	assert.equal(text, "$12.34");
});

test("formatStatusLineQuotaStatus: currency window", () => {
	const text = formatStatusLineQuotaStatus([
		base({
			label: "Extra",
			usedValue: 12.5,
			limitValue: 100,
			isCurrency: true,
			usedPercent: 12.5,
			resetsAt: new Date(0),
		}),
	]);
	assert.equal(text, "$87.50/$100.00 88%");
});

test("formatStatusLineQuotaStatus: count window with non-100 limit", () => {
	const text = formatStatusLineQuotaStatus([
		base({
			provider: "github-copilot",
			label: "Chat / month",
			usedValue: 30,
			limitValue: 1000,
			usedPercent: 30,
			resetsAt: new Date(0),
		}),
	]);
	assert.equal(text, "970/1000 70%");
});

test("formatStatusLineQuotaStatus: appends '!' when limited", () => {
	const text = formatStatusLineQuotaStatus([base({ limited: true, resetsAt: new Date(0) })]);
	assert.equal(text, "50% !");
});

test("formatStatusLineQuotaStatus: prefers 5h then 7d", () => {
	const windows = [
		base({ label: "Other", usedPercent: 10, resetsAt: new Date(0) }),
		base({
			label: "7d",
			usedPercent: 60,
			windowSeconds: 7 * 24 * 60 * 60,
			resetsAt: new Date(0),
		}),
		base({
			label: "5h",
			usedPercent: 50,
			windowSeconds: 5 * 60 * 60,
			resetsAt: new Date(0),
		}),
	];
	const text = formatStatusLineQuotaStatus(windows);
	assert.match(text, /^50% 40%$/);
});

test("formatQuotaCountdown: days+hours form when >1 day", () => {
	const window = base({ resetsAt: new Date(Date.now() + 50 * 60 * 60 * 1000) });
	assert.equal(formatQuotaCountdown(window), "2d2h");
});

test("formatQuotaCountdown: hours+minutes form when <1 day", () => {
	const window = base({ resetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000) });
	assert.match(formatQuotaCountdown(window), /^5h\d+m$/);
});

test("formatQuotaCountdown: minutes-only form", () => {
	const window = base({ resetsAt: new Date(Date.now() + 45 * 60 * 1000) });
	assert.equal(formatQuotaCountdown(window), "45m");
});

test("formatQuotaCountdown: returns undefined for missing reset", () => {
	const window = base({ resetsAt: new Date(0) });
	assert.equal(formatQuotaCountdown(window), undefined);
});
