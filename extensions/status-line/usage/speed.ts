export class SpeedTracker {
	private readonly now: () => number;
	private startedAt: number | undefined;
	private totalOutputTokens = 0;
	private totalElapsedMs = 0;

	constructor(now: () => number = Date.now) {
		this.now = now;
	}

	responseStart(): void {
		this.startedAt = this.now();
	}

	responseEnd(outputTokens?: number): void {
		const start = this.startedAt;
		this.startedAt = undefined;
		const tokens = typeof outputTokens === "number" ? outputTokens : 0;
		if (start == null || tokens <= 0) return;
		this.totalOutputTokens += tokens;
		this.totalElapsedMs += Math.max(0, this.now() - start);
	}

	getTokensPerSecond(): number | undefined {
		if (this.totalOutputTokens <= 0 || this.totalElapsedMs <= 0) return undefined;
		return (this.totalOutputTokens / this.totalElapsedMs) * 1000;
	}

	reset(): void {
		this.startedAt = undefined;
		this.totalOutputTokens = 0;
		this.totalElapsedMs = 0;
	}
}
