import type { ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatExtensionStatuses, formatStatsLine, formatTopLine } from "./footer/format.ts";

function renderFooter(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider, width: number): string[] {
	const lines = [formatTopLine(ctx, footerData, width), formatStatsLine(ctx, footerData, width)];
	const extensionStatuses = formatExtensionStatuses(footerData, width);
	if (extensionStatuses) lines.push(extensionStatuses);
	return lines;
}

function createFooterComponent(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			return renderFooter(ctx, footerData, width);
		},
	};
}

export function installStatusLineFooter(ctx: ExtensionContext): void {
	ctx.ui.setFooter((tui, _theme, footerData) => {
		const component = createFooterComponent(ctx, footerData);
		const dispose = footerData.onBranchChange(() => tui.requestRender());
		return { ...component, dispose };
	});
}
