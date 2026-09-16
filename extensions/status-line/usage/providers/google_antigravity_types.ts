export interface AntigravityQuotaBucket {
	bucketId?: string;
	displayName?: string;
	window?: string;
	resetTime?: string;
	remainingFraction?: number;
}

export interface AntigravityQuotaGroup {
	displayName?: string;
	buckets?: AntigravityQuotaBucket[];
}

export interface AntigravityQuotaSummaryResponse {
	groups?: AntigravityQuotaGroup[];
	buckets?: AntigravityQuotaBucket[];
}

export interface AntigravityModel {
	quotaInfo?: {
		remainingFraction?: number;
		resetTime?: string;
		isExhausted?: boolean;
	};
}

export interface AntigravityModelsResponse {
	models?: Record<string, AntigravityModel>;
}

export type AntigravityUsageResponse = AntigravityQuotaSummaryResponse & AntigravityModelsResponse;
