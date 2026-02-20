"use client";

import AuthGuard from "@/components/auth-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBalance } from "@/hooks/use-balance";
import { useUser } from "@/hooks/use-auth";
import { useLivePrices } from "@/hooks/use-prices";
import { useOpenOrders } from "@/hooks/use-trades";
import { useEffect } from "react";

export default function Home() {
	const { data: user } = useUser();
	const { data: balance } = useBalance();
	const { data: openOrders } = useOpenOrders();
	const { prices, isConnected } = useLivePrices();

	useEffect(() => {
		if (prices.length > 0) {
			console.log("useLivePrices updates:", prices);
		}
	}, [prices]);

	return (
		<AuthGuard>
			<div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
				<Card className="border-border/80 shadow-none">
					<CardHeader>
						<CardTitle>Account</CardTitle>
					</CardHeader>
					<CardContent className="space-y-1 text-sm">
						<p>Email: {user?.email ?? "-"}</p>
						<p>
							Balance:{" "}
							{balance ? `${balance.available.toFixed(2)} available` : "Loading..."}
						</p>
						<p>Open Orders: {openOrders?.length ?? 0}</p>
					</CardContent>
				</Card>

				<Card className="border-border/80 shadow-none">
					<CardHeader>
						<CardTitle>Realtime Stream</CardTitle>
					</CardHeader>
					<CardContent className="space-y-1 text-sm">
						<p>Status: {isConnected ? "Connected" : "Disconnected"}</p>
						<p>Tracked Assets: {prices.length}</p>
					</CardContent>
				</Card>
			</div>
		</AuthGuard>
	);
}
