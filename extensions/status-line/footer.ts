import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatExtensionStatuses, formatStatsLine, formatTopLine } from "./footer/format.ts";

function renderFooter(
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
	options: { width: number; showExtensionStatuses: boolean },
): string[] {
	const { width, showExtensionStatuses } = options;
	const lines = [
		formatTopLine(ctx, footerData, { width }),
		formatStatsLine(ctx, footerData, { width, showExtensionStatuses }),
	];
	const extensionStatuses = showExtensionStatuses ? formatExtensionStatuses(footerData, width) : undefined;
	if (extensionStatuses) lines.push(extensionStatuses);
	return lines;
}

function createFooterComponent(
	ctx: ExtensionContext,
	footerData: ReadonlyFooterDataProvider,
	showExtensionStatuses: () => boolean,
): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			return renderFooter(ctx, footerData, { width, showExtensionStatuses: showExtensionStatuses() });
		},
	};
}

export function installStatusLineFooter(
	ctx: ExtensionContext,
	showExtensionStatuses: () => boolean = () => false,
): void {
	ctx.ui.setFooter((tui, _theme, footerData) => {
		const component = createFooterComponent(ctx, footerData, showExtensionStatuses);
		const dispose = footerData.onBranchChange(() => tui.requestRender());
		return { ...component, dispose };
	});
}
