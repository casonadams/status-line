const LOCAL_PROVIDERS = new Set(["llama-cpp", "mlx"]);

const PROVIDER_LABELS: Record<string, string> = {
	"openai-codex": "Codex",
	anthropic: "Anthropic",
	"github-copilot": "GitHub Copilot",
	"google-antigravity": "Google Antigravity",
	ollama: "Ollama",
	"llama-cpp": "llama.cpp",
	mlx: "MLX",
};

export function isLocalProvider(provider: string | undefined): boolean {
	return !!provider && (LOCAL_PROVIDERS.has(provider) || provider.startsWith("spark-"));
}

export function providerLabel(provider: string): string {
	return PROVIDER_LABELS[provider] ?? provider;
}

export function formatUsageNumber(value: number): string {
	if (!Number.isFinite(value) || value < 1_000) return `${Math.round(value)}`;
	if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}M`;
}

export function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}
