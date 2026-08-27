import assert from "node:assert/strict";
import { test } from "node:test";

import { SpeedTracker } from "./speed.ts";

test("computes average tokens per second from response timing", () => {
	let now = 0;
	const speed = new SpeedTracker(() => now);
	speed.responseStart();
	now += 500;
	speed.responseEnd(250);

	assert.equal(speed.getTokensPerSecond(), 500);
});

test("averages across multiple responses", () => {
	let now = 0;
	const speed = new SpeedTracker(() => now);
	speed.responseStart();
	now += 200;
	speed.responseEnd(100);
	speed.responseStart();
	now += 300;
	speed.responseEnd(100);

	assert.equal(speed.getTokensPerSecond(), 400);
});

test("excludes tool execution after the assistant response", () => {
	let now = 0;
	const speed = new SpeedTracker(() => now);
	speed.responseStart();
	now += 200;
	speed.responseEnd(100);
	now += 10_000;

	assert.equal(speed.getTokensPerSecond(), 500);
});

test("ignores responses with zero output tokens", () => {
	let now = 0;
	const speed = new SpeedTracker(() => now);
	speed.responseStart();
	now += 100;
	speed.responseEnd(0);
	assert.equal(speed.getTokensPerSecond(), undefined);

	speed.responseStart();
	now += 100;
	speed.responseEnd(50);
	assert.equal(speed.getTokensPerSecond(), 500);
});

test("response end without a matching start is ignored", () => {
	const speed = new SpeedTracker();
	speed.responseEnd(50);
	assert.equal(speed.getTokensPerSecond(), undefined);
});

test("reset clears accumulated speed", () => {
	let now = 0;
	const speed = new SpeedTracker(() => now);
	speed.responseStart();
	now += 100;
	speed.responseEnd(50);
	speed.reset();
	assert.equal(speed.getTokensPerSecond(), undefined);
});
