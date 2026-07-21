import { type ExtensionAPI, type ExtensionContext, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { installStatusLineFooter } from "./footer.ts";
import { createQuotaCache, fetchProviderQuotas, isSupportedProvider } from "./usage/fetch.ts";
import { formatStatusLineQuotaStatus } from "./usage/format.ts";
import type { QuotaAuth } from "./usage/helpers.ts";

const EXTENSION_ID = "status-line";

class StatusLineExtension {
	private currentProvider: string | undefined;
	private readonly cache = createQuotaCache();
	private readonly pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	install(): void {
		this.pi.on("session_start", (_event, ctx) => void this.start(ctx));
		this.pi.on("turn_end", (_event, ctx) => void this.refreshForContext(ctx));
		this.pi.on("model_select", (_event, ctx) => void this.refreshForContext(ctx));
		this.pi.on("session_shutdown", (_event, ctx) => this.stop(ctx));
	}

	private setStatus(ctx: ExtensionContext, status?: string, color: "dim" | "warning" = "dim"): void {
		ctx.ui.setStatus(EXTENSION_ID, status ? ctx.ui.theme.fg(color, status) : undefined);
	}

	private async resolveStatus(ctx: ExtensionContext): Promise<string | undefined> {
		const provider = this.currentProvider;
		if (!provider || !isSupportedProvider(provider)) return undefined;

		const auth: QuotaAuth = {
			getApiKey: (providerId) => ctx.modelRegistry.getApiKeyForProvider(providerId),
			getCredential: (providerId) => readStoredCredential(providerId),
		};
		const result = await fetchProviderQuotas(auth, provider, this.cache);
		if (!result.success) return undefined;
		return formatStatusLineQuotaStatus(result.data.windows);
	}

	private setErrorStatus(ctx: ExtensionContext): void {
		this.setStatus(
			ctx,
			ctx.model ? `quota fetch failed (${this.currentProvider ?? "unknown"})` : "no model",
			"warning",
		);
	}

	private async refreshStatus(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) return;
		if (!isSupportedProvider(this.currentProvider)) {
			this.setStatus(ctx, undefined);
			return;
		}
		try {
			const status = await this.resolveStatus(ctx);
			if (status) {
				this.setStatus(ctx, status);
				return;
			}
			this.setErrorStatus(ctx);
		} catch {
			this.setErrorStatus(ctx);
		}
	}

	private async refreshForContext(ctx: ExtensionContext): Promise<void> {
		this.currentProvider = ctx.model?.provider;
		await this.refreshStatus(ctx);
	}

	private stop(ctx: ExtensionContext): void {
		this.currentProvider = undefined;
		if (ctx.hasUI) {
			ctx.ui.setFooter(undefined);
			ctx.ui.setStatus(EXTENSION_ID, undefined);
		}
	}

	private async start(ctx: ExtensionContext): Promise<void> {
		this.currentProvider = ctx.model?.provider;
		if (!ctx.hasUI) return;

		installStatusLineFooter(ctx);
		await this.refreshStatus(ctx);
	}
}

export default function (pi: ExtensionAPI): void {
	new StatusLineExtension(pi).install();
}
