const DEFAULT_API_BASE_URL = "http://localhost:8080";

function normalizeBaseUrl(value: string) {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}

export const API_BASE_URL = normalizeBaseUrl(
	process.env.NEXT_PUBLIC_API_BASE_URL ??
		process.env.NEXT_PUBLIC_SERVER_URL ??
		DEFAULT_API_BASE_URL,
);

export function getApiUrl(path: string) {
	if (path.startsWith("http://") || path.startsWith("https://")) {
		return path;
	}

	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${API_BASE_URL}${normalizedPath}`;
}

export class ApiError extends Error {
	status: number;
	body: unknown;

	constructor(message: string, status: number, body: unknown) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

type RequestOptions = Omit<RequestInit, "body"> & {
	body?: unknown;
};

async function readJsonSafe<T>(response: Response): Promise<T | null> {
	const raw = await response.text();
	if (!raw) {
		return null;
	}

	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const headers = new Headers(options.headers);
	let body: BodyInit | undefined;

	if (options.body !== undefined) {
		headers.set("Content-Type", "application/json");
		body = JSON.stringify(options.body);
	}

	const response = await fetch(getApiUrl(path), {
		...options,
		headers,
		body,
		credentials: "include",
	});

	const json = await readJsonSafe<Record<string, unknown>>(response);

	if (!response.ok) {
		const message =
			typeof json?.message === "string" ? json.message : "Request failed";
		throw new ApiError(message, response.status, json);
	}

	return (json ?? {}) as T;
}

export type AssetSymbol = "BTC" | "ETH" | "SOL";
export type OrderSide = "LONG" | "SHORT";
export type OrderStatus = "OPEN" | "CLOSED" | "LIQUIDATED";
export type CloseReason = "USER" | "TAKE_PROFIT" | "STOP_LOSS" | "LIQUIDATION";

export type AuthUser = {
	id: string;
	email: string | null;
	lastLoggedIn: string | null;
};

export type Balance = {
	available: number;
	locked: number;
	total: number;
};

export type OrderAsset = {
	id: string;
	symbol: string;
	name: string;
	imageUrl: string;
};

export type TradeOrder = {
	id: string;
	userId: string;
	assetId: string;
	side: OrderSide;
	quantity: number;
	margin: number;
	leverage: number;
	entryPrice: number;
	closePrice: number | null;
	pnl: number | null;
	status: OrderStatus;
	closeReason: CloseReason | null;
	takeProfit: number | null;
	stopLoss: number | null;
	liquidationPrice: number;
	createdAt: string;
	updatedAt: string;
	closedAt: string | null;
	asset: OrderAsset;
};

export type CreateTradeInput = {
	asset: AssetSymbol;
	side: OrderSide;
	margin: number;
	leverage: number;
	slippage: number;
	takeProfit?: number;
	stopLoss?: number;
};

export type PriceUpdate = {
	asset: string;
	price: string;
	timestamp: string;
};

export type TradeCallbackEvent = {
	type: "TRADE_OPENED" | "TRADE_CLOSED" | "TRADE_ERROR";
	orderId: string;
	userId?: string;
	asset?: string;
	status?: OrderStatus;
	reason?: CloseReason;
	entryPrice?: number;
	closePrice?: number;
	pnl?: number;
	message?: string;
	timestamp?: string;
};

export const api = {
	auth: {
		async login(email: string) {
			return apiRequest<{ success: boolean; message: string }>("/api/auth/login", {
				method: "POST",
				body: { email },
			});
		},
		async me() {
			try {
				const response = await apiRequest<{ user: AuthUser }>("/api/auth/me");
				return response.user;
			} catch (error) {
				if (
					error instanceof ApiError &&
					(error.status === 401 || error.status === 404)
				) {
					return null;
				}
				throw error;
			}
		},
		async logout() {
			return apiRequest<{ success: boolean; message: string }>("/api/auth/logout", {
				method: "POST",
			});
		},
	},
	balance: {
		async get() {
			const response = await apiRequest<{
				success: boolean;
				balance?: Balance;
				data?: Balance;
			}>("/api/balance");

			const balance = response.balance ?? response.data;
			if (!balance) {
				throw new Error("Balance payload missing");
			}

			return balance;
		},
	},
	trade: {
		async create(input: CreateTradeInput) {
			return apiRequest<{ success: boolean; orderId: string }>("/api/trade/create", {
				method: "POST",
				body: input,
			});
		},
		async close(orderId: string) {
			return apiRequest<{ success: boolean; orderId: string; message: string }>(
				"/api/trade/close",
				{
					method: "POST",
					body: { orderId },
				},
			);
		},
		async getOrders(status?: OrderStatus) {
			const params = new URLSearchParams();
			if (status) {
				params.set("status", status);
			}

			const query = params.toString();
			const path = query ? `/api/trade/orders?${query}` : "/api/trade/orders";
			const response = await apiRequest<{ success: boolean; orders: TradeOrder[] }>(
				path,
			);
			return response.orders;
		},
		async getOrder(orderId: string) {
			const response = await apiRequest<{ success: boolean; order: TradeOrder }>(
				`/api/trade/orders/${orderId}`,
			);
			return response.order;
		},
	},
};
