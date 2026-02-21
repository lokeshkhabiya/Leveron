"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBalance } from "@/hooks/use-balance";

type BalanceDisplayProps = {
	isLiveConnected: boolean;
};

function formatCurrency(value: number) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	}).format(value);
}

export default function BalanceDisplay({ isLiveConnected }: BalanceDisplayProps) {
	const { data: balance, isLoading } = useBalance({
		enableBackgroundPolling: !isLiveConnected,
	});

	return (
		<Card className="border-border/80 bg-card/90 shadow-sm">
			<CardHeader className="pb-3">
				<CardTitle className="text-sm font-medium tracking-[0.02em] uppercase">
					Balance
				</CardTitle>
			</CardHeader>
			<CardContent className="grid gap-3 md:grid-cols-3">
				<div className="space-y-1 border-l-2 border-primary pl-3">
					<p className="text-muted-foreground text-xs uppercase">Available</p>
					<p className="font-mono text-lg">
						{isLoading || !balance ? "..." : formatCurrency(balance.available)}
					</p>
				</div>
				<div className="space-y-1 border-l-2 border-border pl-3">
					<p className="text-muted-foreground text-xs uppercase">Locked</p>
					<p className="font-mono text-lg">
						{isLoading || !balance ? "..." : formatCurrency(balance.locked)}
					</p>
				</div>
				<div className="space-y-1 border-l-2 border-border pl-3">
					<p className="text-muted-foreground text-xs uppercase">Total</p>
					<p className="font-mono text-lg">
						{isLoading || !balance ? "..." : formatCurrency(balance.total)}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}
