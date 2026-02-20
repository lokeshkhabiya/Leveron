"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const BALANCE_QUERY_KEY = ["balance"] as const;

export function useBalance() {
	return useQuery({
		queryKey: BALANCE_QUERY_KEY,
		queryFn: () => api.balance.get(),
		refetchInterval: 5000,
	});
}
