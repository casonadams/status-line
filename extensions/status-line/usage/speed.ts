/**
 * Tracks output-token generation speed from turn lifecycle events.
 * Only generation time (turn start -> turn end) counts; idle time between
 * turns is excluded so the average reflects real streaming throughput.
 */
export class SpeedTracker {
	private readonly now: () => number;
	private readonly starts = new Map<number, number>();
	private totalOutputTokens = 0;
	private totalElapsedMs = 0;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	turnStart(turnIndex: number): void {
		this.starts.set(turnIndex, this.now());
	}

	turnEnd(turnIndex: number, outputTokens?: number): void {
		const start = this.starts.get(turnIndex);
		this.starts.delete(turnIndex);
		const tokens = typeof outputTokens === "number" ? outputTokens : 0;
		if (start == null || tokens <= 0) return;
		this.totalOutputTokens += tokens;
		this.totalElapsedMs += Math.max(0, this.now() - start);
	}

	/** Average output tokens per second across tracked turns. */
	getTokensPerSecond(): number | undefined {
		if (this.totalOutputTokens <= 0 || this.totalElapsedMs <= 0) return undefined;
		return (this.totalOutputTokens / this.totalElapsedMs) * 1000;
	}

	reset(): void {
		this.starts.clear();
		this.totalOutputTokens = 0;
		this.totalElapsedMs = 0;
	}
}
