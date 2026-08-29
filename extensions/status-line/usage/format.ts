import type { QuotaWindow } from "./types.ts";

const PREFERRED_WINDOW_LABELS: readonly string[] = ["5h", "7d"];

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function formatPercent(value: number): string {
	return `${clampPercent(value)}%`;
}

function formatCount(value: number): string {
	return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

function formatCurrency(value: number): string {
	return `$${value.toFixed(2)}`;
}

function formatQuotaWindowValue(window: QuotaWindow): string {
	if (window.unlimited) return "unlimited";
	if (window.label === "Spend cap") return window.limited ? "REACHED" : "OK";
	if (window.label === "Credits") return formatCurrency(window.usedValue);

	const remaining = Math.max(0, window.limitValue - window.usedValue);
	const percent = formatPercent(100 - window.usedPercent);

	if (window.isCurrency && window.limitValue > 0) {
		return `${formatCurrency(remaining)}/${formatCurrency(window.limitValue)} ${percent}`;
	}

	if (window.isCurrency) return formatCurrency(remaining);

	if (window.limitValue > 0 && window.limitValue !== 100) {
		return `${formatCount(remaining)}/${formatCount(window.limitValue)} ${percent}`;
	}

	return percent;
}

export function formatQuotaCountdown(window: QuotaWindow): string | undefined {
	const resetAt = window.resetsAt?.getTime?.();
	if (resetAt === undefined || !Number.isFinite(resetAt) || resetAt <= 0) return undefined;

	const totalSeconds = Math.max(0, Math.round((resetAt - Date.now()) / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);

	if (days) return `${days}d${hours}h`;
	if (hours) return `${hours}h${minutes}m`;
	if (minutes) return `${minutes}m`;
	return `${totalSeconds % 60}s`;
}

function selectQuotaWindows(windows: readonly QuotaWindow[]): QuotaWindow[] {
	const preferred = PREFERRED_WINDOW_LABELS.map((label) => windows.find((window) => window.label === label)).filter(
		(window): window is QuotaWindow => !!window,
	);
	return preferred.length > 0 ? preferred : [...windows].slice(0, 2);
}

export function formatStatusLineQuotaStatus(windows: readonly QuotaWindow[]): string | undefined {
	if (windows.length === 0) return undefined;
	const selected = selectQuotaWindows(windows);
	const parts: string[] = [];
	for (const window of selected) {
		parts.push(`${formatQuotaWindowValue(window)}${window.limited ? " !" : ""}`);
		const countdown = formatQuotaCountdown(window);
		if (countdown) parts.push(countdown);
	}
	return parts.join(" ");
}
