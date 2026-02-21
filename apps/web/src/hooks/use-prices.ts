"use client";

import { getApiUrl, type PriceUpdate, type TradeCallbackEvent } from "@/lib/api";
import { createLogger } from "@/lib/logger";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BALANCE_QUERY_KEY } from "./use-balance";
import { ORDER_HISTORY_QUERY_KEY, OPEN_ORDERS_QUERY_KEY } from "./use-trades";

type PriceEventPayload = {
	updates: PriceUpdate[];
};

type ErrorEventPayload = {
	message?: string;
};

function parseEventData<T>(event: Event): T | null {
	try {
		const message = event as MessageEvent<string>;
		return JSON.parse(message.data) as T;
	} catch {
		return null;
	}
}

export function useLivePrices() {
	const logger = useMemo(() => createLogger("web.live-prices"), []);
	const queryClient = useQueryClient();
	const [pricesByAsset, setPricesByAsset] = useState<Record<string, PriceUpdate>>({});
	const [tradeEvents, setTradeEvents] = useState<TradeCallbackEvent[]>([]);
	const [isConnected, setIsConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const eventSource = new EventSource(getApiUrl("/api/prices/stream"), {
			withCredentials: true,
		});

		const onConnected = () => {
			setIsConnected(true);
			setError(null);
			logger.info("sse.connected");
		};

		const onPrice = (event: Event) => {
			const payload = parseEventData<PriceEventPayload>(event);
			if (!payload) {
				return;
			}

			setPricesByAsset((previous) => {
				const next = { ...previous };
				for (const update of payload.updates) {
					next[update.asset] = update;
				}
				return next;
			});
		};

		const onTrade = (event: Event) => {
			const payload = parseEventData<TradeCallbackEvent>(event);
			if (!payload) {
				return;
			}

			setTradeEvents((previous) => [payload, ...previous].slice(0, 100));
			void queryClient.invalidateQueries({ queryKey: OPEN_ORDERS_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: ORDER_HISTORY_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: BALANCE_QUERY_KEY });
		};

		const onServerError = (event: Event) => {
			const payload = parseEventData<ErrorEventPayload>(event);
			setError(payload?.message ?? "Server sent an SSE error");
			logger.warn("sse.server-error", {
				message: payload?.message ?? "Server sent an SSE error",
			});
		};

		const onBrowserError = () => {
			setIsConnected(false);
			setError("Connection to live price stream failed");
			logger.warn("sse.connection-error");
		};

		eventSource.onopen = onConnected;
		eventSource.onerror = onBrowserError;
		eventSource.addEventListener("connected", onConnected);
		eventSource.addEventListener("price", onPrice);
		eventSource.addEventListener("trade", onTrade);
		eventSource.addEventListener("error", onServerError);

		return () => {
			eventSource.removeEventListener("connected", onConnected);
			eventSource.removeEventListener("price", onPrice);
			eventSource.removeEventListener("trade", onTrade);
			eventSource.removeEventListener("error", onServerError);
			eventSource.close();
		};
	}, [logger, queryClient]);

	useEffect(() => {
		if (isConnected) {
			return;
		}

		const interval = window.setInterval(() => {
			void queryClient.invalidateQueries({ queryKey: OPEN_ORDERS_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: ORDER_HISTORY_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: BALANCE_QUERY_KEY });
		}, 10_000);

		return () => {
			window.clearInterval(interval);
		};
	}, [isConnected, queryClient]);

	const prices = useMemo(() => Object.values(pricesByAsset), [pricesByAsset]);

	const getPrice = useCallback(
		(asset: string) => {
			return pricesByAsset[asset] ?? null;
		},
		[pricesByAsset],
	);

	return {
		pricesByAsset,
		prices,
		tradeEvents,
		isConnected,
		error,
		getPrice,
	};
}
