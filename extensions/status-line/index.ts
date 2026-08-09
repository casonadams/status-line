import { type ExtensionAPI, type ExtensionContext, readStoredCredential } from "@earendil-works/pi-coding-agent";
import { installStatusLineFooter } from "./footer.ts";
import { createQuotaCache, fetchProviderQuotas, isSupportedProvider } from "./usage/fetch.ts";
import { formatStatusLineQuotaStatus } from "./usage/format.ts";
import type { QuotaAuth } from "./usage/helpers.ts";

const EXTENSION_ID = "status-line";

class StatusLineExtension {
	private currentProvider: string | undefined;
	private refreshGeneration = 0;
	private showExtensionStatuses = false;
	private readonly cache = createQuotaCache();
	private readonly pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	install(): void {
		this.pi.registerCommand("status-line.statuses", {
			description: "Toggle extension statuses in the footer",
			handler: async (_args, ctx) => this.toggleExtensionStatuses(ctx),
		});
		this.pi.on("session_start", (_event, ctx) => void this.start(ctx));
		this.pi.on("turn_end", (_event, ctx) => void this.refreshForContext(ctx));
		this.pi.on("model_select", (_event, ctx) => void this.refreshForContext(ctx));
		this.pi.on("session_shutdown", (_event, ctx) => this.stop(ctx));
	}

	private setStatus(ctx: ExtensionContext, status?: string, color: "dim" | "warning" = "dim"): void {
		ctx.ui.setStatus(EXTENSION_ID, status ? ctx.ui.theme.fg(color, status) : undefined);
	}

	private toggleExtensionStatuses(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		this.showExtensionStatuses = !this.showExtensionStatuses;
		installStatusLineFooter(ctx, () => this.showExtensionStatuses);
		ctx.ui.notify(`Extension statuses ${this.showExtensionStatuses ? "shown" : "hidden"}`, "info");
	}

	private async resolveStatus(ctx: ExtensionContext, provider: string): Promise<string | undefined> {
		if (!isSupportedProvider(provider)) return undefined;

		const auth: QuotaAuth = {
			modelId: ctx.model?.id,
			getApiKey: (providerId) => ctx.modelRegistry.getApiKeyForProvider(providerId),
			getCredential: (providerId) => readStoredCredential(providerId),
		};
		const result = await fetchProviderQuotas(auth, provider, this.cache);
		if (!result.success) return undefined;
		return formatStatusLineQuotaStatus(result.data.windows);
	}

	private setErrorStatus(ctx: ExtensionContext, provider: string): void {
		this.setStatus(ctx, ctx.model ? `quota fetch failed (${provider})` : "no model", "warning");
	}

	private async refreshStatus(ctx: ExtensionContext, generation: number): Promise<void> {
		if (!ctx.hasUI) return;
		const provider = this.currentProvider;
		if (!isSupportedProvider(provider)) {
			this.setStatus(ctx, undefined);
			return;
		}
		try {
			const status = await this.resolveStatus(ctx, provider);
			if (generation !== this.refreshGeneration) return;
			if (status) {
				this.setStatus(ctx, status);
				return;
			}
			this.setErrorStatus(ctx, provider);
		} catch {
			if (generation === this.refreshGeneration) this.setErrorStatus(ctx, provider);
		}
	}

	private async refreshForContext(ctx: ExtensionContext): Promise<void> {
		const generation = ++this.refreshGeneration;
		this.currentProvider = ctx.model?.provider;
		await this.refreshStatus(ctx, generation);
	}

	private stop(ctx: ExtensionContext): void {
		this.refreshGeneration++;
		this.currentProvider = undefined;
		if (ctx.hasUI) {
			ctx.ui.setFooter(undefined);
			ctx.ui.setStatus(EXTENSION_ID, undefined);
		}
	}

	private async start(ctx: ExtensionContext): Promise<void> {
		const generation = ++this.refreshGeneration;
		this.currentProvider = ctx.model?.provider;
		if (!ctx.hasUI) return;

		installStatusLineFooter(ctx, () => this.showExtensionStatuses);
		await this.refreshStatus(ctx, generation);
	}
}

export default function (pi: ExtensionAPI): void {
	new StatusLineExtension(pi).install();
}
