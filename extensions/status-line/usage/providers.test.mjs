import assert from "node:assert/strict";
import { test } from "node:test";

import { formatStatusLineQuotaStatus } from "./format.ts";
import { parseAnthropicUsage } from "./providers/anthropic.ts";
import { parseGitHubCopilotUsage } from "./providers/github_copilot.ts";
import { parseGoogleAntigravityUsage } from "./providers/google_antigravity.ts";
import { parseCodexUsage } from "./providers/openai_codex.ts";

// ── Anthropic ──────────────────────────────────────────────────────────────

test("parseAnthropicUsage: 5h and 7d windows", () => {
	const windows = parseAnthropicUsage({
		five_hour: { utilization: 12, resets_at: "2026-01-01T00:00:00Z" },
		seven_day: { utilization: 34, resets_at: 1_700_000_000_000 },
	});
	assert.equal(windows.length, 2);
	assert.equal(windows[0].label, "5h");
	assert.equal(windows[0].usedPercent, 12);
	assert.equal(windows[1].label, "7d");
	assert.equal(windows[1].usedPercent, 34);
});

test("parseAnthropicUsage: extra usage with monthly_limit and is_enabled", () => {
	const windows = parseAnthropicUsage({
		extra_usage: {
			is_enabled: true,
			monthly_limit: 1000,
			used_credits: 250,
		},
	});
	assert.equal(windows.length, 1);
	assert.equal(windows[0].label, "Extra");
	assert.equal(windows[0].limitValue, 10);
	assert.equal(windows[0].usedValue, 2.5);
	assert.equal(windows[0].isCurrency, true);
});

test("parseAnthropicUsage: extra usage skipped when disabled", () => {
	const windows = parseAnthropicUsage({
		extra_usage: { is_enabled: false, monthly_limit: 1000 },
	});
	assert.equal(windows.length, 0);
});

// ── GitHub Copilot ─────────────────────────────────────────────────────────

test("parseGitHubCopilotUsage: maps each snapshot key", () => {
	const windows = parseGitHubCopilotUsage({
		quota_reset_date: "2026-02-01T00:00:00Z",
		quota_snapshots: {
			premium_interactions: { entitlement: 100, remaining: 80 },
			chat: { entitlement: 200, remaining: 50 },
			completions: { unlimited: true },
		},
	});
	assert.equal(windows.length, 2);
	const labels = windows.map((w) => w.label);
	assert.ok(labels.includes("Premium / month"));
	assert.ok(labels.includes("Chat / month"));
});

test("parseGitHubCopilotUsage: preserves an all-unlimited quota state", () => {
	const windows = parseGitHubCopilotUsage({
		quota_snapshots: {
			chat: { unlimited: true },
			completions: { unlimited: true },
		},
	});
	assert.equal(windows.length, 1);
	assert.equal(windows[0].unlimited, true);
});

test("parseGitHubCopilotUsage: skips zero-entitlement snapshots", () => {
	const windows = parseGitHubCopilotUsage({
		quota_snapshots: {
			chat: { entitlement: 0, remaining: 0 },
		},
	});
	assert.equal(windows.length, 0);
});

test("parseGitHubCopilotUsage: falls back to quota_remaining field", () => {
	const windows = parseGitHubCopilotUsage({
		quota_snapshots: {
			chat: { entitlement: 100, quota_remaining: 90 },
		},
	});
	assert.equal(windows.length, 1);
	assert.equal(windows[0].usedValue, 10);
	assert.equal(windows[0].usedPercent, 10);
});

// ── OpenAI Codex ───────────────────────────────────────────────────────────

test("parseCodexUsage: percent_left is inverted to used", () => {
	const windows = parseCodexUsage({
		rate_limit: { primary_window: { percent_left: 80 } },
	});
	assert.equal(windows.length, 1);
	assert.equal(windows[0].label, "5h");
	assert.equal(windows[0].usedPercent, 20);
});

test("parseCodexUsage: remaining_percent is inverted", () => {
	const windows = parseCodexUsage({
		rate_limits: { secondary: { remaining_percent: 75 } },
	});
	assert.equal(windows.length, 1);
	assert.equal(windows[0].label, "7d");
	assert.equal(windows[0].usedPercent, 25);
});

test("parseCodexUsage: alias keys for primary/secondary", () => {
	const windows = parseCodexUsage({
		rate_limit: {
			five_hour_limit: { used_percent: 10 },
			weekly_limit: { used_percent: 20 },
		},
	});
	assert.equal(windows.length, 2);
	assert.equal(windows[0].label, "5h");
	assert.equal(windows[0].usedPercent, 10);
	assert.equal(windows[1].label, "7d");
	assert.equal(windows[1].usedPercent, 20);
});

test("parseCodexUsage: credits branch", () => {
	const windows = parseCodexUsage({
		credits: { has_credits: true, balance: 12.34 },
	});
	assert.equal(windows.length, 1);
	assert.equal(windows[0].label, "Credits");
	assert.equal(windows[0].isCurrency, true);
	assert.equal(windows[0].limitValue, 12.34);
});

test("parseCodexUsage: credits skipped when has_credits false", () => {
	const windows = parseCodexUsage({
		credits: { has_credits: false, balance: 12.34 },
	});
	assert.equal(windows.length, 0);
});

// ── Google Antigravity ─────────────────────────────────────────────────────

test("parseGoogleAntigravityUsage: treats a future reset without remainingFraction as exhausted", () => {
	const windows = parseGoogleAntigravityUsage(
		{
			models: {
				"gemini-3.6-flash-medium": { quotaInfo: { resetTime: "2099-01-01T00:00:00Z" } },
				"claude-sonnet-4-6": { quotaInfo: { remainingFraction: 1 } },
			},
		},
		"gemini-3.6-flash",
	);
	assert.equal(windows.length, 1);
	assert.equal(windows[0].provider, "google-antigravity");
	assert.equal(windows[0].label, "7d");
	assert.equal(windows[0].usedPercent, 100);
	assert.equal(windows[0].limited, true);
	assert.match(formatStatusLineQuotaStatus(windows), /^0% /);
});

test("parseGoogleAntigravityUsage: uses the lowest remaining quota when the model is unknown", () => {
	const windows = parseGoogleAntigravityUsage({
		models: {
			claude: { quotaInfo: { remainingFraction: 0.8 } },
			gemini: { quotaInfo: { remainingFraction: 0.2 } },
		},
	});
	assert.equal(windows.length, 1);
	assert.equal(windows[0].usedPercent, 80);
});
