"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AuthUser } from "@/lib/api";

export const AUTH_USER_QUERY_KEY = ["auth", "user"] as const;

export function useUser() {
	return useQuery<AuthUser | null>({
		queryKey: AUTH_USER_QUERY_KEY,
		queryFn: () => api.auth.me(),
		staleTime: 30_000,
	});
}

export function useLogin() {
	return useMutation({
		mutationFn: (email: string) => api.auth.login(email),
	});
}

export function useLogout() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: () => api.auth.logout(),
		onSuccess: () => {
			queryClient.setQueryData(AUTH_USER_QUERY_KEY, null);
			void queryClient.invalidateQueries({ queryKey: ["balance"] });
			void queryClient.invalidateQueries({ queryKey: ["trades"] });
		},
	});
}
