"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CreateTradeInput, type TradeOrder } from "@/lib/api";

export const OPEN_ORDERS_QUERY_KEY = ["trades", "open"] as const;
export const ORDER_HISTORY_QUERY_KEY = ["trades", "history"] as const;

type TradeQueryOptions = {
	enableBackgroundPolling?: boolean;
};

export function useOpenOrders({ enableBackgroundPolling = true }: TradeQueryOptions = {}) {
	return useQuery({
		queryKey: OPEN_ORDERS_QUERY_KEY,
		queryFn: () => api.trade.getOrders("OPEN"),
		refetchInterval: enableBackgroundPolling ? 15_000 : false,
	});
}

export function useOrderHistory({
	enableBackgroundPolling = true,
}: TradeQueryOptions = {}) {
	return useQuery({
		queryKey: ORDER_HISTORY_QUERY_KEY,
		queryFn: async () => {
			const orders = await api.trade.getOrders();
			return orders.filter((order) => order.status !== "OPEN");
		},
		refetchInterval: enableBackgroundPolling ? 20_000 : false,
	});
}

export function useCreateTrade() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: CreateTradeInput) => api.trade.create(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: OPEN_ORDERS_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: ORDER_HISTORY_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: ["balance"] });
		},
	});
}

export function useCloseTrade() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (orderId: string) => api.trade.close(orderId),
		onMutate: async (orderId: string) => {
			await queryClient.cancelQueries({ queryKey: OPEN_ORDERS_QUERY_KEY });

			const previousOpenOrders =
				queryClient.getQueryData<TradeOrder[]>(OPEN_ORDERS_QUERY_KEY) ?? [];

			queryClient.setQueryData<TradeOrder[]>(
				OPEN_ORDERS_QUERY_KEY,
				previousOpenOrders.filter((order) => order.id !== orderId),
			);

			return { previousOpenOrders };
		},
		onError: (_error, _orderId, context) => {
			if (context?.previousOpenOrders) {
				queryClient.setQueryData(OPEN_ORDERS_QUERY_KEY, context.previousOpenOrders);
			}
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: OPEN_ORDERS_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: ORDER_HISTORY_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: ["balance"] });
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: OPEN_ORDERS_QUERY_KEY });
			void queryClient.invalidateQueries({ queryKey: ORDER_HISTORY_QUERY_KEY });
		},
	});
}
