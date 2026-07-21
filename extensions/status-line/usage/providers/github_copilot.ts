import { execFileSync } from "node:child_process";
import {
	COPILOT_VERSION,
	EDITOR_VERSION,
	type FetchJsonResult,
	failure,
	fetchJson,
	monthWindowSeconds,
	parseDateish,
	providerAccessToken,
	type QuotaAuth,
	safePercent,
	success,
} from "../helpers.ts";
import type { QuotaWindow } from "../types.ts";

function copilotHeaders(authHeader: string): Record<string, string> {
	return {
		Accept: "application/json",
		Authorization: authHeader,
		"User-Agent": `GitHubCopilotChat/${COPILOT_VERSION}`,
		"Editor-Version": EDITOR_VERSION,
		"Editor-Plugin-Version": `copilot-chat/${COPILOT_VERSION}`,
		"Copilot-Integration-Id": "vscode-chat",
		"Content-Type": "application/json",
	};
}

function ghCliToken(): string | undefined {
	try {
		return (
			execFileSync("gh", ["auth", "token"], {
				timeout: 5000,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim() || undefined
		);
	} catch {
		return undefined;
	}
}

async function tryGitHubUserEndpoint(authHeader: string): Promise<FetchJsonResult<CopilotUsageResponse>> {
	return fetchJson<CopilotUsageResponse>("https://api.github.com/copilot_internal/user", {
		headers: copilotHeaders(authHeader),
	});
}

interface CopilotCredential {
	type?: string;
	refresh?: string;
}

interface CopilotQuotaSnapshot {
	unlimited?: boolean;
	entitlement?: number;
	remaining?: number;
	quota_remaining?: number;
}

interface CopilotUsageResponse {
	quota_reset_date?: string;
	quota_reset_date_utc?: string;
	limited_user_reset_date?: string;
	quota_snapshots?: Record<string, CopilotQuotaSnapshot>;
}

function githubOAuthToken(auth: QuotaAuth): string | undefined {
	const credential = auth.getCredential("github-copilot") as CopilotCredential | undefined;
	if (credential?.type === "oauth" && typeof credential.refresh === "string") return credential.refresh;
	return undefined;
}

export function parseGitHubCopilotUsage(data: CopilotUsageResponse | undefined): QuotaWindow[] {
	const windows: QuotaWindow[] = [];
	const resetAt = parseDateish(data?.quota_reset_date ?? data?.quota_reset_date_utc ?? data?.limited_user_reset_date);
	const periodSeconds = monthWindowSeconds(resetAt);
	const snapshots = data?.quota_snapshots;
	if (snapshots && typeof snapshots === "object") {
		const mappings: Array<[string, string]> = [
			["premium_interactions", "Premium / month"],
			["chat", "Chat / month"],
			["completions", "Completions / month"],
		];
		for (const [key, label] of mappings) {
			const snap = snapshots[key];
			if (!snap || snap.unlimited) continue;
			const entitlement = Number(snap.entitlement ?? 0);
			const remaining = Number(snap.remaining ?? snap.quota_remaining ?? 0);
			if (entitlement <= 0) continue;
			windows.push({
				provider: "github-copilot",
				label,
				usedPercent: safePercent(entitlement - remaining, entitlement),
				resetsAt: resetAt,
				windowSeconds: periodSeconds,
				usedValue: entitlement - remaining,
				limitValue: entitlement,
			});
		}
	}
	return windows;
}

async function tryWithToken(token: string, scheme: "Bearer" | "token") {
	const usage = await tryGitHubUserEndpoint(`${scheme} ${token}`);
	return usage.ok ? success("github-copilot", parseGitHubCopilotUsage(usage.data)) : null;
}

export async function fetchGitHubCopilotQuotas(auth: QuotaAuth) {
	const githubToken = githubOAuthToken(auth);
	if (githubToken) {
		const result = (await tryWithToken(githubToken, "Bearer")) ?? (await tryWithToken(githubToken, "token"));
		if (result) return result;
	}

	const accessToken = await providerAccessToken(auth, "github-copilot");
	if (accessToken) {
		const exchange = await fetchJson<{ token?: string }>("https://api.github.com/copilot_internal/v2/token", {
			headers: copilotHeaders(`Bearer ${accessToken}`),
		});
		if (exchange.ok && exchange.data?.token) {
			const result = await tryWithToken(exchange.data.token, "Bearer");
			if (result) return result;
		}
		const direct = await tryWithToken(accessToken, "token");
		if (direct) return direct;
	}

	const cliToken = ghCliToken();
	if (cliToken) {
		const cliUsage = await tryGitHubUserEndpoint(`token ${cliToken}`);
		if (cliUsage.ok) return success("github-copilot", parseGitHubCopilotUsage(cliUsage.data));
		return failure(cliUsage.message, cliUsage.kind);
	}

	return failure("No GitHub Copilot credentials found", "config");
}
