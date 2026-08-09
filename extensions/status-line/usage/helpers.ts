import type { QuotasResult, QuotaWindow, SupportedQuotaProvider } from "./types.ts";

export const FETCH_TIMEOUT_MS = 15_000;
export const COPILOT_VERSION = "0.35.0";
export const EDITOR_VERSION = "vscode/1.107.0";

export interface QuotaAuth {
	modelId?: string;
	getApiKey(provider: string): Promise<string | undefined>;
	getCredential(provider: string): unknown;
}

export type FetchJsonResult<T = unknown> =
	| { ok: true; data: T }
	| {
			ok: false;
			status?: number;
			message: string;
			kind: "timeout" | "cancelled" | "http" | "network";
	  };

export function safePercent(used: number, limit: number): number {
	if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
	return Math.max(0, Math.min(100, (used / limit) * 100));
}

export function parseDateish(value: unknown): Date {
	if (typeof value === "number") {
		const ms = value > 10 ** 11 ? value : value * 1000;
		return new Date(ms);
	}
	if (typeof value === "string") return new Date(value);
	return new Date(0);
}

export function monthWindowSeconds(resetAt: Date): number {
	const approxStart = new Date(resetAt);
	approxStart.setMonth(approxStart.getMonth() - 1);
	return Math.max(1, Math.round((resetAt.getTime() - approxStart.getTime()) / 1000));
}

export async function fetchJson<T = unknown>(
	url: string,
	init: RequestInit,
	signal?: AbortSignal,
): Promise<FetchJsonResult<T>> {
	const signals: AbortSignal[] = [AbortSignal.timeout(FETCH_TIMEOUT_MS)];
	if (signal) signals.push(signal);
	const combined = AbortSignal.any(signals);

	try {
		const response = await fetch(url, { ...init, signal: combined });
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			return {
				ok: false,
				status: response.status,
				message: body || response.statusText || `HTTP ${response.status}`,
				kind: "http",
			};
		}
		return { ok: true, data: (await response.json()) as T };
	} catch (err: unknown) {
		const isAbort = combined.aborted || (err instanceof DOMException && err.name === "AbortError");
		if (isAbort) {
			const reason = combined.reason;
			if (reason instanceof DOMException && reason.name === "TimeoutError") {
				return { ok: false, message: "Request timed out", kind: "timeout" };
			}
			return { ok: false, message: "Request cancelled", kind: "cancelled" };
		}
		const message = err instanceof Error ? err.message : "Unknown error";
		return { ok: false, message, kind: "network" };
	}
}

export function failure(message: string, kind: "cancelled" | "timeout" | "config" | "http" | "network"): QuotasResult {
	return { success: false, error: { message, kind } };
}

export function success(provider: SupportedQuotaProvider, windows: QuotaWindow[]): QuotasResult {
	return { success: true, data: { provider, windows } };
}

export function providerAccessToken(auth: QuotaAuth, provider: string): Promise<string | undefined> {
	return auth.getApiKey(provider);
}
