"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const BALANCE_QUERY_KEY = ["balance"] as const;

type BalanceQueryOptions = {
	enableBackgroundPolling?: boolean;
};

export function useBalance({
	enableBackgroundPolling = true,
}: BalanceQueryOptions = {}) {
	return useQuery({
		queryKey: BALANCE_QUERY_KEY,
		queryFn: () => api.balance.get(),
		refetchInterval: enableBackgroundPolling ? 15_000 : false,
	});
}
