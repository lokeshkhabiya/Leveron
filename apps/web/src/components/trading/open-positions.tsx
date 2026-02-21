"use client";

import { Button } from "@/components/ui/button";
import { useCloseTrade, useOpenOrders } from "@/hooks/use-trades";
import type { PriceUpdate, TradeOrder } from "@/lib/api";

type OpenPositionsProps = {
	pricesByAsset: Record<string, PriceUpdate>;
	isLiveConnected: boolean;
};

function formatNumber(value: number, maximumFractionDigits = 2) {
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits,
	}).format(value);
}

function calculateLivePnl(order: TradeOrder, markPrice: number) {
	if (order.side === "LONG") {
		return (markPrice - order.entryPrice) * order.quantity;
	}
	return (order.entryPrice - markPrice) * order.quantity;
}

export default function OpenPositions({
	pricesByAsset,
	isLiveConnected,
}: OpenPositionsProps) {
	const { data: openOrders, isLoading } = useOpenOrders({
		enableBackgroundPolling: !isLiveConnected,
	});
	const closeTrade = useCloseTrade();

	return (
		<section className="border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
					Open Positions
				</p>
				<p className="font-mono text-xs">{openOrders?.length ?? 0}</p>
			</div>

			<div className="overflow-x-auto">
				{closeTrade.error ? (
					<p className="mb-3 text-xs text-destructive">{closeTrade.error.message}</p>
				) : null}
				<table className="w-full min-w-[900px] border-collapse text-sm">
					<thead>
						<tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
							<th className="px-2 py-2">Asset</th>
							<th className="px-2 py-2">Side</th>
							<th className="px-2 py-2">Entry</th>
							<th className="px-2 py-2">Qty</th>
							<th className="px-2 py-2">Margin</th>
							<th className="px-2 py-2">Leverage</th>
							<th className="px-2 py-2">Live PnL</th>
							<th className="px-2 py-2">Liq</th>
							<th className="px-2 py-2">TP / SL</th>
							<th className="px-2 py-2">Action</th>
						</tr>
					</thead>
					<tbody>
						{isLoading ? (
							<tr>
								<td className="px-2 py-3 text-muted-foreground" colSpan={10}>
									Loading positions...
								</td>
							</tr>
						) : openOrders && openOrders.length > 0 ? (
							openOrders.map((order) => {
								const markPriceRaw = pricesByAsset[order.asset.symbol]?.price;
								const markPrice = markPriceRaw ? Number(markPriceRaw) : order.entryPrice;
								const livePnl = calculateLivePnl(order, markPrice);

								return (
									<tr key={order.id} className="border-b border-border/70">
										<td className="px-2 py-2 font-mono">{order.asset.symbol}</td>
										<td className="px-2 py-2">{order.side}</td>
										<td className="px-2 py-2 font-mono">
											{formatNumber(order.entryPrice, 4)}
										</td>
										<td className="px-2 py-2 font-mono">
											{formatNumber(order.quantity, 6)}
										</td>
										<td className="px-2 py-2 font-mono">
											{formatNumber(order.margin)}
										</td>
										<td className="px-2 py-2 font-mono">{order.leverage}x</td>
										<td
											className={[
												"px-2 py-2 font-mono",
												livePnl >= 0 ? "text-emerald-600" : "text-red-600",
											].join(" ")}
										>
											{formatNumber(livePnl)}
										</td>
										<td className="px-2 py-2 font-mono">
											{formatNumber(order.liquidationPrice, 4)}
										</td>
										<td className="px-2 py-2 font-mono">
											{order.takeProfit ? formatNumber(order.takeProfit, 4) : "--"} /{" "}
											{order.stopLoss ? formatNumber(order.stopLoss, 4) : "--"}
										</td>
										<td className="px-2 py-2">
											<Button
												size="sm"
												variant="outline"
												className="rounded-none"
												disabled={closeTrade.isPending}
												onClick={() => closeTrade.mutate(order.id)}
											>
												{closeTrade.isPending && closeTrade.variables === order.id
													? "Closing..."
													: "Close"}
											</Button>
										</td>
									</tr>
								);
							})
						) : (
							<tr>
								<td className="px-2 py-3 text-muted-foreground" colSpan={10}>
									No open positions
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}
