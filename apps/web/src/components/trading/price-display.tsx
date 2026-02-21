"use client";

import type { AssetSymbol } from "@/lib/api";
import type { PriceUpdate } from "@/lib/api";
import { useEffect, useMemo, useRef, useState } from "react";

type PriceDisplayProps = {
	selectedAsset: AssetSymbol;
	onSelectAsset: (asset: AssetSymbol) => void;
	pricesByAsset: Record<string, PriceUpdate>;
	isConnected: boolean;
};

const ASSETS: AssetSymbol[] = ["BTC", "ETH", "SOL"];

function formatPrice(asset: AssetSymbol, value: number) {
	const digits = asset === "BTC" ? 2 : 4;
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(value);
}

export default function PriceDisplay({
	selectedAsset,
	onSelectAsset,
	pricesByAsset,
	isConnected,
}: PriceDisplayProps) {
	const previousPricesRef = useRef<Record<string, number>>({});
	const [flashByAsset, setFlashByAsset] = useState<Record<string, "up" | "down">>({});

	const numericPrices = useMemo(() => {
		const result: Record<AssetSymbol, number | null> = {
			BTC: null,
			ETH: null,
			SOL: null,
		};

		for (const asset of ASSETS) {
			const priceRaw = pricesByAsset[asset]?.price;
			result[asset] = priceRaw ? Number(priceRaw) : null;
		}

		return result;
	}, [pricesByAsset]);

	useEffect(() => {
		const nextFlash: Record<string, "up" | "down"> = {};

		for (const asset of ASSETS) {
			const current = numericPrices[asset];
			if (current === null || Number.isNaN(current)) {
				continue;
			}

			const previous = previousPricesRef.current[asset];
			if (previous !== undefined && current !== previous) {
				nextFlash[asset] = current > previous ? "up" : "down";
			}
			previousPricesRef.current[asset] = current;
		}

		if (Object.keys(nextFlash).length === 0) {
			return;
		}

		setFlashByAsset(nextFlash);
		const timer = setTimeout(() => {
			setFlashByAsset({});
		}, 450);

		return () => clearTimeout(timer);
	}, [numericPrices]);

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-xs uppercase tracking-[0.08em]">
					Live Prices
				</p>
				<p className="text-muted-foreground text-xs">
					{isConnected ? "Stream: connected" : "Stream: reconnecting"}
				</p>
			</div>
			<div className="grid gap-2 md:grid-cols-3">
				{ASSETS.map((asset) => {
					const price = numericPrices[asset];
					const isSelected = selectedAsset === asset;
					const flash = flashByAsset[asset];

					return (
						<button
							key={asset}
							type="button"
							onClick={() => onSelectAsset(asset)}
							className={[
								"rounded-none border p-3 text-left transition-colors",
								isSelected ? "border-primary" : "border-border",
								flash === "up"
									? "bg-emerald-500/10"
									: flash === "down"
										? "bg-red-500/10"
										: "bg-card",
							].join(" ")}
						>
							<p className="text-muted-foreground text-xs uppercase">{asset}</p>
							<p className="mt-1 font-mono text-xl">
								{price === null ? "--" : formatPrice(asset, price)}
							</p>
						</button>
					);
				})}
			</div>
		</section>
	);
}
