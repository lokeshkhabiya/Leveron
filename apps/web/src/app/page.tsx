"use client";

import AuthGuard from "@/components/auth-guard";
import Header from "@/components/header";
import BalanceDisplay from "@/components/trading/balance-display";
import OpenPositions from "@/components/trading/open-positions";
import OrderForm from "@/components/trading/order-form";
import OrderHistory from "@/components/trading/order-history";
import PriceChart from "@/components/trading/price-chart";
import PriceDisplay from "@/components/trading/price-display";
import { useLivePrices } from "@/hooks/use-prices";
import type { AssetSymbol } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export default function Home() {
	return (
		<AuthGuard>
			<TradingDashboard />
		</AuthGuard>
	);
}

function TradingDashboard() {
	const [selectedAsset, setSelectedAsset] = useState<AssetSymbol>("BTC");
	const { pricesByAsset, isConnected, tradeEvents, error } = useLivePrices();
	const lastHandledTradeEventRef = useRef<string | null>(null);
	const lastHandledErrorRef = useRef<string | null>(null);
	const markPrice = pricesByAsset[selectedAsset]
		? Number(pricesByAsset[selectedAsset].price)
		: null;

	useEffect(() => {
		const latestEvent = tradeEvents[0];
		if (!latestEvent) {
			return;
		}

		const eventKey = `${latestEvent.type}:${latestEvent.orderId}:${latestEvent.timestamp ?? ""}:${latestEvent.message ?? ""}`;
		if (lastHandledTradeEventRef.current === eventKey) {
			return;
		}
		lastHandledTradeEventRef.current = eventKey;

		if (latestEvent.type === "TRADE_OPENED") {
			toast.success("Order opened", {
				description: latestEvent.orderId,
			});
			return;
		}

		if (latestEvent.type === "TRADE_CLOSED") {
			toast.success("Order closed", {
				description: latestEvent.orderId,
			});
			return;
		}

		if (latestEvent.type === "TRADE_ERROR") {
			toast.error("Trade failed", {
				description: latestEvent.message ?? "Unknown trading error",
			});
		}
	}, [tradeEvents]);

	useEffect(() => {
		if (!error || lastHandledErrorRef.current === error) {
			return;
		}

		lastHandledErrorRef.current = error;
		toast.error("Live stream issue", { description: error });
	}, [error]);

	return (
		<div className="min-h-screen bg-background">
			<Header isLiveConnected={isConnected} />
			<main className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-4 md:py-6">
				<BalanceDisplay isLiveConnected={isConnected} />
				<PriceDisplay
					selectedAsset={selectedAsset}
					onSelectAsset={setSelectedAsset}
					pricesByAsset={pricesByAsset}
					isConnected={isConnected}
				/>

				<section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
					<PriceChart asset={selectedAsset} interval="1m" />
					<OrderForm
						selectedAsset={selectedAsset}
						onSelectAsset={setSelectedAsset}
						markPrice={markPrice}
					/>
				</section>

				<OpenPositions
					pricesByAsset={pricesByAsset}
					isLiveConnected={isConnected}
				/>
				<OrderHistory isLiveConnected={isConnected} />
			</main>
			</div>
	);
}
