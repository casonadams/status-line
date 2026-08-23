import assert from "node:assert/strict";
import { test } from "node:test";

import { SpeedTracker } from "./speed.ts";

test("computes average tokens per second from turn timing", () => {
	let now = 0;
	const speed = new SpeedTracker(() => now);
	speed.turnStart(0);
	now += 500;
	speed.turnEnd(0, 250);

	assert.equal(speed.getTokensPerSecond(), 500);
});

test("averages across multiple turns", () => {
	let now = 0;
	const speed = new SpeedTracker(() => now);
	speed.turnStart(0);
	now += 200;
	speed.turnEnd(0, 100); // 500 tps
	speed.turnStart(1);
	now += 300;
	speed.turnEnd(1, 100); // ~333 tps

	assert.equal(speed.getTokensPerSecond(), 400);
});

test("ignores turns with zero output tokens", () => {
	let now = 0;
	const speed = new SpeedTracker(() => now);
	speed.turnStart(0);
	now += 100;
	speed.turnEnd(0, 0);
	assert.equal(speed.getTokensPerSecond(), undefined);

	speed.turnStart(1);
	now += 100;
	speed.turnEnd(1, 50);
	assert.equal(speed.getTokensPerSecond(), 500);
});

test("turn end without a matching start is ignored", () => {
	const speed = new SpeedTracker();
	speed.turnEnd(0, 50);
	assert.equal(speed.getTokensPerSecond(), undefined);
});

test("reset clears accumulated speed", () => {
	let now = 0;
	const speed = new SpeedTracker(() => now);
	speed.turnStart(0);
	now += 100;
	speed.turnEnd(0, 50);
	speed.reset();
	assert.equal(speed.getTokensPerSecond(), undefined);
});
