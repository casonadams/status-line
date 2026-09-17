import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function fitRightAligned(left: string, right: string, width: number): string {
	const safeRight = visibleWidth(right) > width ? truncateToWidth(right, width, "") : right;
	if (visibleWidth(left) + visibleWidth(safeRight) + 2 <= width) {
		return `${left}${" ".repeat(width - visibleWidth(left) - visibleWidth(safeRight))}${safeRight}`;
	}

	const availableLeft = Math.max(0, width - visibleWidth(safeRight) - 2);
	const truncatedLeft = truncateToWidth(left, availableLeft, "...");
	const padding = Math.max(0, width - visibleWidth(truncatedLeft) - visibleWidth(safeRight));
	return `${truncatedLeft}${" ".repeat(padding)}${safeRight}`;
}

export function formatTokens(count: number): string {
	if (count < 1_000) return `${count}`;
	if (count < 100_000) {
		const formatted = (count / 1_000).toFixed(1);
		return formatted.endsWith(".0") ? `${Math.round(count / 1_000)}k` : `${formatted}k`;
	}
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	const formattedM = (count / 1_000_000).toFixed(1);
	return formattedM.endsWith(".0") ? `${Math.round(count / 1_000_000)}M` : `${formattedM}M`;
}

export function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}
