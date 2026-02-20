"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CreateTradeInput } from "@/lib/api";

export const OPEN_ORDERS_QUERY_KEY = ["trades", "open"] as const;
export const ORDER_HISTORY_QUERY_KEY = ["trades", "history"] as const;

export function useOpenOrders() {
	return useQuery({
		queryKey: OPEN_ORDERS_QUERY_KEY,
		queryFn: () => api.trade.getOrders("OPEN"),
		refetchInterval: 5000,
	});
}

export function useOrderHistory() {
	return useQuery({
		queryKey: ORDER_HISTORY_QUERY_KEY,
		queryFn: async () => {
			const orders = await api.trade.getOrders();
			return orders.filter((order) => order.status !== "OPEN");
		},
		refetchInterval: 10_000,
	});
}

export function useCreateTrade() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: CreateTradeInput) => api.trade.create(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["trades"] });
			void queryClient.invalidateQueries({ queryKey: ["balance"] });
		},
	});
}

export function useCloseTrade() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (orderId: string) => api.trade.close(orderId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["trades"] });
			void queryClient.invalidateQueries({ queryKey: ["balance"] });
		},
	});
}
