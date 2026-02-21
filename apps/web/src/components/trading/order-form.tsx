"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateTrade } from "@/hooks/use-trades";
import type { AssetSymbol, OrderSide } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type OrderFormProps = {
	selectedAsset: AssetSymbol;
	onSelectAsset: (asset: AssetSymbol) => void;
	markPrice: number | null;
};

const ASSETS: AssetSymbol[] = ["BTC", "ETH", "SOL"];

const MAX_LEVERAGE_BY_ASSET: Record<AssetSymbol, number> = {
	BTC: 100,
	ETH: 50,
	SOL: 20,
};

function formatPrice(value: number) {
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 4,
	}).format(value);
}

export default function OrderForm({
	selectedAsset,
	onSelectAsset,
	markPrice,
}: OrderFormProps) {
	const createTrade = useCreateTrade();

	const [side, setSide] = useState<OrderSide>("LONG");
	const [margin, setMargin] = useState("100");
	const [leverage, setLeverage] = useState(10);
	const [slippage, setSlippage] = useState("1");
	const [takeProfit, setTakeProfit] = useState("");
	const [stopLoss, setStopLoss] = useState("");

	const maxLeverage = MAX_LEVERAGE_BY_ASSET[selectedAsset];
	const hasPrice = markPrice !== null && Number.isFinite(markPrice) && markPrice > 0;

	useEffect(() => {
		setLeverage((previous) => Math.min(previous, maxLeverage));
	}, [maxLeverage]);

	const estimates = useMemo(() => {
		if (!hasPrice) {
			return {
				entryPrice: null,
				liquidationPrice: null,
			};
		}

		const currentMarkPrice = markPrice ?? 0;
		const slippagePct = Number(slippage) / 100;
		const entryPrice =
			side === "LONG"
				? currentMarkPrice * (1 + slippagePct)
				: currentMarkPrice * (1 - slippagePct);
		const liquidationPrice =
			side === "LONG"
				? entryPrice * (1 - 1 / leverage)
				: entryPrice * (1 + 1 / leverage);

		return {
			entryPrice,
			liquidationPrice,
		};
	}, [hasPrice, leverage, markPrice, side, slippage]);

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const marginValue = Number(margin);
		const slippageValue = Number(slippage);

		try {
			const response = await createTrade.mutateAsync({
				asset: selectedAsset,
				side,
				margin: Number.isFinite(marginValue) ? marginValue : 0,
				leverage,
				slippage: Number.isFinite(slippageValue) ? slippageValue : 0,
				takeProfit: takeProfit ? Number(takeProfit) : undefined,
				stopLoss: stopLoss ? Number(stopLoss) : undefined,
			});

			toast.success("Order request accepted", {
				description: response.orderId,
			});
		} catch {
			// Error is already surfaced via mutation state below.
		}
	};

	return (
		<section className="border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
					Order Form
				</p>
				<p className="font-mono text-sm">{selectedAsset}</p>
			</div>

			<form className="space-y-3" onSubmit={onSubmit}>
				<div className="grid grid-cols-3 gap-2">
					{ASSETS.map((asset) => (
						<button
							key={asset}
							type="button"
							onClick={() => onSelectAsset(asset)}
							className={[
								"h-9 border text-xs tracking-wide uppercase",
								selectedAsset === asset
									? "border-primary bg-primary text-primary-foreground"
									: "border-border bg-card",
							].join(" ")}
						>
							{asset}
						</button>
					))}
				</div>

				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						onClick={() => setSide("LONG")}
						className={[
							"h-9 border text-xs tracking-wide uppercase",
							side === "LONG"
								? "border-primary bg-primary text-primary-foreground"
								: "border-border bg-card",
						].join(" ")}
					>
						Long
					</button>
					<button
						type="button"
						onClick={() => setSide("SHORT")}
						className={[
							"h-9 border text-xs tracking-wide uppercase",
							side === "SHORT"
								? "border-primary bg-primary text-primary-foreground"
								: "border-border bg-card",
						].join(" ")}
					>
						Short
					</button>
				</div>

				<div className="grid gap-2">
					<label className="text-muted-foreground text-xs uppercase">Margin (USD)</label>
					<Input
						type="number"
						min={1}
						step="0.01"
						value={margin}
						onChange={(event) => setMargin(event.target.value)}
					/>
				</div>

				<div className="grid gap-2">
					<div className="flex items-center justify-between">
						<label className="text-muted-foreground text-xs uppercase">Leverage</label>
						<span className="font-mono text-xs">{leverage}x</span>
					</div>
					<input
						type="range"
						min={1}
						max={maxLeverage}
						value={leverage}
						onChange={(event) => setLeverage(Number(event.target.value))}
					/>
				</div>

				<div className="grid gap-2">
					<label className="text-muted-foreground text-xs uppercase">
						Slippage (%)
					</label>
					<Input
						type="number"
						min={0}
						step="0.1"
						value={slippage}
						onChange={(event) => setSlippage(event.target.value)}
					/>
				</div>

				<div className="grid grid-cols-2 gap-2">
					<div className="space-y-2">
						<label className="text-muted-foreground text-xs uppercase">Take Profit</label>
						<Input
							type="number"
							step="0.01"
							value={takeProfit}
							onChange={(event) => setTakeProfit(event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<label className="text-muted-foreground text-xs uppercase">Stop Loss</label>
						<Input
							type="number"
							step="0.01"
							value={stopLoss}
							onChange={(event) => setStopLoss(event.target.value)}
						/>
					</div>
				</div>

				<div className="space-y-1 border-t border-border pt-2 text-xs">
					<p className="text-muted-foreground">
						Entry:{" "}
						<span className="font-mono text-foreground">
							{estimates.entryPrice ? formatPrice(estimates.entryPrice) : "--"}
						</span>
					</p>
					<p className="text-muted-foreground">
						Liquidation:{" "}
						<span className="font-mono text-foreground">
							{estimates.liquidationPrice
								? formatPrice(estimates.liquidationPrice)
								: "--"}
						</span>
					</p>
				</div>

				<Button className="w-full rounded-none" type="submit" disabled={createTrade.isPending}>
					{createTrade.isPending ? "Placing..." : `Place ${side}`}
				</Button>

				{createTrade.error ? (
					<p className="text-sm text-red-600 dark:text-red-400">
						{createTrade.error.message}
					</p>
				) : null}
			</form>
		</section>
	);
}
