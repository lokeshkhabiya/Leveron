"use client";

import { getApiUrl, type AssetSymbol } from "@/lib/api";
import { createLogger } from "@/lib/logger";
import {
	CandlestickSeries,
	ColorType,
	createChart,
	type IChartApi,
	type ISeriesApi,
	type CandlestickData,
	type UTCTimestamp,
	type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

type BackpackInterval = "1m" | "5m" | "15m";

type PriceChartProps = {
	asset: AssetSymbol;
	interval?: BackpackInterval;
};

const BACKPACK_WS_URL = "wss://ws.backpack.exchange/";

const SYMBOL_BY_ASSET: Record<AssetSymbol, string> = {
	BTC: "BTC_USDC",
	ETH: "ETH_USDC",
	SOL: "SOL_USDC",
};

const INTERVAL_SECONDS: Record<BackpackInterval, number> = {
	"1m": 60,
	"5m": 300,
	"15m": 900,
};

const CHART_COLORS = {
	text: "#A1A1AA",
	grid: "#E4E4E7",
	crosshair: "#D4D4D8",
	scaleBorder: "#D4D4D8",
	up: "#6366F1",
	down: "#EF4444",
} as const;

function parseTimestamp(value: unknown): number | null {
	if (typeof value === "number") {
		if (!Number.isFinite(value)) return null;
		return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
	}

	if (typeof value === "string") {
		const numericValue = Number(value);
		if (Number.isFinite(numericValue)) {
			return parseTimestamp(numericValue);
		}

		const dateValue = Date.parse(value);
		if (!Number.isNaN(dateValue)) {
			return Math.floor(dateValue / 1000);
		}
	}

	return null;
}

function parseNumber(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function normalizeKline(input: unknown): CandlestickData<UTCTimestamp> | null {
	if (Array.isArray(input) && input.length >= 5) {
		const time = parseTimestamp(input[0]);
		const open = parseNumber(input[1]);
		const high = parseNumber(input[2]);
		const low = parseNumber(input[3]);
		const close = parseNumber(input[4]);

		if (time === null || open === null || high === null || low === null || close === null) {
			return null;
		}

		return {
			time: time as UTCTimestamp,
			open,
			high,
			low,
			close,
		};
	}

	if (typeof input === "object" && input !== null) {
		const record = input as Record<string, unknown>;
		const time =
			parseTimestamp(record.time) ??
			parseTimestamp(record.t) ??
			parseTimestamp(record.startTime) ??
			parseTimestamp(record.start);
		const open = parseNumber(record.open ?? record.o);
		const high = parseNumber(record.high ?? record.h);
		const low = parseNumber(record.low ?? record.l);
		const close = parseNumber(record.close ?? record.c);

		if (time === null || open === null || high === null || low === null || close === null) {
			return null;
		}

		return {
			time: time as UTCTimestamp,
			open,
			high,
			low,
			close,
		};
	}

	return null;
}

function toKlineArray(payload: unknown): CandlestickData<UTCTimestamp>[] {
	if (!Array.isArray(payload)) {
		return [];
	}

	return payload
		.map((entry) => normalizeKline(entry))
		.filter((entry): entry is CandlestickData<UTCTimestamp> => entry !== null)
		.sort((a, b) => Number(a.time) - Number(b.time));
}

function extractKlineFromWsMessage(payload: unknown) {
	if (typeof payload !== "object" || payload === null) {
		return null;
	}

	const message = payload as Record<string, unknown>;

	const directKline = normalizeKline(message);
	if (directKline) {
		return directKline;
	}

	if (typeof message.data === "object" && message.data !== null) {
		return normalizeKline(message.data);
	}

	return null;
}

export default function PriceChart({ asset, interval = "1m" }: PriceChartProps) {
	const logger = useMemo(() => createLogger("web.price-chart"), []);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const chartRef = useRef<IChartApi | null>(null);
	const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
	const [status, setStatus] = useState("Loading chart...");
	const symbol = SYMBOL_BY_ASSET[asset];

	const streamName = useMemo(() => `kline.${interval}.${symbol}`, [interval, symbol]);

	useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const chart = createChart(containerRef.current, {
			height: 380,
			layout: {
				background: { type: ColorType.Solid, color: "transparent" },
				textColor: CHART_COLORS.text,
			},
			grid: {
				vertLines: { color: CHART_COLORS.grid },
				horzLines: { color: CHART_COLORS.grid },
			},
			crosshair: {
				vertLine: {
					color: CHART_COLORS.crosshair,
				},
				horzLine: {
					color: CHART_COLORS.crosshair,
				},
			},
			rightPriceScale: {
				borderColor: CHART_COLORS.scaleBorder,
			},
			timeScale: {
				borderColor: CHART_COLORS.scaleBorder,
				timeVisible: true,
			},
		});

		const series = chart.addSeries(CandlestickSeries, {
			upColor: CHART_COLORS.up,
			downColor: CHART_COLORS.down,
			borderUpColor: CHART_COLORS.up,
			borderDownColor: CHART_COLORS.down,
			wickUpColor: CHART_COLORS.up,
			wickDownColor: CHART_COLORS.down,
			priceLineVisible: false,
		});

		chartRef.current = chart;
		seriesRef.current = series;

		const resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				if (entry.target === containerRef.current) {
					chart.applyOptions({ width: entry.contentRect.width });
				}
			}
		});

		resizeObserver.observe(containerRef.current);

		return () => {
			resizeObserver.disconnect();
			seriesRef.current = null;
			chart.remove();
			chartRef.current = null;
		};
	}, []);

	useEffect(() => {
		const series = seriesRef.current;
		if (!series) {
			return;
		}

		let active = true;
		let socket: WebSocket | null = null;

		const loadInitialBars = async () => {
			const now = Math.floor(Date.now() / 1000);
			const seconds = INTERVAL_SECONDS[interval];
			const startTime = now - seconds * 300;
			const query = new URLSearchParams({
				symbol,
				interval,
				startTime: String(startTime),
				endTime: String(now),
			});

			const response = await fetch(
				getApiUrl(`/api/prices/klines?${query.toString()}`),
				{
					credentials: "include",
					cache: "no-store",
				},
			);
			if (!response.ok) {
				throw new Error(`Failed to load candles (${response.status})`);
			}

			const payload = (await response.json()) as unknown;
			const bars = toKlineArray(payload);

			if (!active) {
				return;
			}

			series.setData(bars as CandlestickData<Time>[]);
			chartRef.current?.timeScale().fitContent();
		};

		const connectWs = () => {
			socket = new WebSocket(BACKPACK_WS_URL);

			socket.addEventListener("open", () => {
				setStatus("Live");
				socket?.send(
					JSON.stringify({
						method: "SUBSCRIBE",
						params: [streamName],
					}),
				);
			});

			socket.addEventListener("message", (event) => {
				try {
					const payload = JSON.parse(String(event.data)) as unknown;
					const bar = extractKlineFromWsMessage(payload);
					if (!bar) {
						return;
					}
					series.update(bar as CandlestickData<Time>);
				} catch (error) {
					logger.error("ws.message-parse-failed", {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			});

			socket.addEventListener("error", () => {
				setStatus("WS error");
			});

			socket.addEventListener("close", () => {
				if (active) {
					setStatus("Reconnecting...");
				}
			});
		};

		setStatus("Loading chart...");
		loadInitialBars()
			.then(() => {
				if (active) {
					connectWs();
				}
			})
			.catch((error) => {
				logger.error("candles.load-failed", {
					error: error instanceof Error ? error.message : String(error),
					symbol,
					interval,
				});
				setStatus("Failed to load candles");
			});

		return () => {
			active = false;
			if (socket?.readyState === WebSocket.OPEN) {
				socket.send(
					JSON.stringify({
						method: "UNSUBSCRIBE",
						params: [streamName],
					}),
				);
			}
			socket?.close();
		};
	}, [asset, interval, logger, streamName, symbol]);

	return (
		<section className="border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between">
				<div>
					<p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
						Candlestick Chart
					</p>
					<p className="font-mono text-sm">
						{symbol} · {interval}
					</p>
				</div>
				<p className="text-xs text-muted-foreground">{status}</p>
			</div>
			<div ref={containerRef} className="h-[380px] w-full" />
		</section>
	);
}
