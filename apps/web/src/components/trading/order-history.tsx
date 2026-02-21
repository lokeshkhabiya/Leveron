"use client";

import { useOrderHistory } from "@/hooks/use-trades";

function formatNumber(value: number | null, maximumFractionDigits = 2) {
	if (value === null) {
		return "--";
	}

	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits,
	}).format(value);
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

type OrderHistoryProps = {
	isLiveConnected: boolean;
};

export default function OrderHistory({ isLiveConnected }: OrderHistoryProps) {
	const { data: orders, isLoading } = useOrderHistory({
		enableBackgroundPolling: !isLiveConnected,
	});

	return (
		<section className="border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
					Order History
				</p>
				<p className="font-mono text-xs">{orders?.length ?? 0}</p>
			</div>

			<div className="overflow-x-auto">
				<table className="w-full min-w-[840px] border-collapse text-sm">
					<thead>
						<tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted-foreground">
							<th className="px-2 py-2">Asset</th>
							<th className="px-2 py-2">Side</th>
							<th className="px-2 py-2">Entry</th>
							<th className="px-2 py-2">Close</th>
							<th className="px-2 py-2">PnL</th>
							<th className="px-2 py-2">Reason</th>
							<th className="px-2 py-2">Date</th>
						</tr>
					</thead>
					<tbody>
						{isLoading ? (
							<tr>
								<td className="px-2 py-3 text-muted-foreground" colSpan={7}>
									Loading order history...
								</td>
							</tr>
						) : orders && orders.length > 0 ? (
							orders.map((order) => (
								<tr key={order.id} className="border-b border-border/70">
									<td className="px-2 py-2 font-mono">{order.asset.symbol}</td>
									<td className="px-2 py-2">{order.side}</td>
									<td className="px-2 py-2 font-mono">
										{formatNumber(order.entryPrice, 4)}
									</td>
									<td className="px-2 py-2 font-mono">
										{formatNumber(order.closePrice, 4)}
									</td>
									<td
										className={[
											"px-2 py-2 font-mono",
											(order.pnl ?? 0) >= 0 ? "text-emerald-600" : "text-red-600",
										].join(" ")}
									>
										{formatNumber(order.pnl, 2)}
									</td>
									<td className="px-2 py-2">{order.closeReason ?? "--"}</td>
									<td className="px-2 py-2">
										{formatDate(order.closedAt ?? order.updatedAt)}
									</td>
								</tr>
							))
						) : (
							<tr>
								<td className="px-2 py-3 text-muted-foreground" colSpan={7}>
									No order history yet
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}
