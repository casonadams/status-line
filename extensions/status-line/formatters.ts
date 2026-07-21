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

export {
	formatTokens,
	formatUsageNumber,
	sanitizeStatusText,
} from "./numbers.ts";
