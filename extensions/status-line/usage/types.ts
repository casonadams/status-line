export type SupportedQuotaProvider =
	| "anthropic"
	| "openai-codex"
	| "github-copilot"
	| "google-antigravity"
	| "ollama-cloud";

export type QuotasErrorKind = "cancelled" | "timeout" | "config" | "http" | "network";

export type QuotasResult =
	| {
			success: true;
			data: { windows: QuotaWindow[]; provider: SupportedQuotaProvider };
	  }
	| { success: false; error: { message: string; kind: QuotasErrorKind } };

export interface QuotaWindow {
	label: string;
	usedPercent: number;
	/** Omit when the upstream API exposes no reset timestamp (e.g. Ollama Cloud); countdown is suppressed. */
	resetsAt?: Date;
	usedValue: number;
	limitValue: number;
	isCurrency?: boolean;
	limited?: boolean;
	unlimited?: boolean;
}
