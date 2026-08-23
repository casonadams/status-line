import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatExtensionStatuses, formatStatsLine, formatTopLine } from "./footer/format.ts";

function renderFooter(
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
	options: { width: number; showExtensionStatuses: boolean; tokensPerSecond?: number },
): string[] {
	const { width, showExtensionStatuses, tokensPerSecond } = options;
	const lines = [
		formatTopLine(ctx, footerData, { width }),
		formatStatsLine(ctx, footerData, { width, showExtensionStatuses, tokensPerSecond }),
	];
	const extensionStatuses = showExtensionStatuses ? formatExtensionStatuses(footerData, width) : undefined;
	if (extensionStatuses) lines.push(extensionStatuses);
	return lines;
}

function createFooterComponent(
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
	options: { showExtensionStatuses: () => boolean; getTokensPerSecond: () => number | undefined },
): Component {
	const { showExtensionStatuses, getTokensPerSecond } = options;
	return {
		invalidate() {},
		render(width: number): string[] {
			return renderFooter(ctx, footerData, {
				width,
				showExtensionStatuses: showExtensionStatuses(),
				tokensPerSecond: getTokensPerSecond(),
			});
		},
	};
}

export function installStatusLineFooter(
	ctx: ExtensionContext,
	options: { showExtensionStatuses: () => boolean; getTokensPerSecond: () => number | undefined } = {
		showExtensionStatuses: () => false,
		getTokensPerSecond: () => undefined,
	},
): void {
	ctx.ui.setFooter((tui, _theme, footerData) => {
		const component = createFooterComponent(ctx, footerData, options);
		const dispose = footerData.onBranchChange(() => tui.requestRender());
		return { ...component, dispose };
	});
}
