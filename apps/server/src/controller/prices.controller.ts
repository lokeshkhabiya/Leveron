import { type extendedRequest } from "@/middleware/auth.middleware";
import {
	registerCallbackHandler,
	type TradeCallbackEvent,
} from "@/services/callback.service";
import { createLogger } from "@/utils/logger";
import { createRedisClient } from "@leveron/redis";
import type { Request, Response } from "express";

type PriceUpdate = {
	asset: string;
	price: string;
	timestamp: string;
};

const PRICE_STREAM = "engine-stream";
const BACKPACK_API_BASE_URL =
	process.env.BACKPACK_API_BASE_URL ?? "https://api.backpack.exchange";
const SUPPORTED_KLINE_INTERVALS = new Set(["1m", "5m", "15m"]);
const logger = createLogger("server.prices-controller");

function getFieldValue(fields: string[], key: string): string | null {
	for (let index = 0; index < fields.length; index += 2) {
		if (fields[index] === key) {
			return fields[index + 1] ?? null;
		}
	}

	return null;
}

function writeSseEvent(res: Response, event: string, data: unknown) {
	res.write(`event: ${event}\n`);
	res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function isValidSymbol(value: string) {
	return /^[A-Z0-9]+_[A-Z0-9]+$/.test(value);
}

function parseUnixSeconds(value: unknown) {
	if (typeof value !== "string") {
		return null;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return null;
	}

	return parsed;
}

const klines = async (req: Request, res: Response) => {
	try {
		const symbol = typeof req.query.symbol === "string" ? req.query.symbol : null;
		const interval =
			typeof req.query.interval === "string" ? req.query.interval : null;
		const startTimeRaw =
			typeof req.query.startTime === "string" ? req.query.startTime : null;
		const endTimeRaw =
			typeof req.query.endTime === "string" ? req.query.endTime : null;

		if (!symbol || !interval || !startTimeRaw || !endTimeRaw) {
			return res.status(400).json({
				success: false,
				message: "Missing required query params: symbol, interval, startTime, endTime",
			});
		}

		if (!SUPPORTED_KLINE_INTERVALS.has(interval)) {
			return res.status(400).json({
				success: false,
				message: "Unsupported interval",
			});
		}

		if (!isValidSymbol(symbol)) {
			return res.status(400).json({
				success: false,
				message: "Invalid symbol format",
			});
		}

		const startTime = parseUnixSeconds(startTimeRaw);
		const endTime = parseUnixSeconds(endTimeRaw);

		if (startTime === null || endTime === null || endTime <= startTime) {
			return res.status(400).json({
				success: false,
				message: "Invalid startTime/endTime",
			});
		}

		const query = new URLSearchParams({
			symbol,
			interval,
			startTime: String(startTime),
			endTime: String(endTime),
		});

		const response = await fetch(
			`${BACKPACK_API_BASE_URL}/api/v1/klines?${query.toString()}`,
			{
				method: "GET",
				headers: {
					Accept: "application/json",
				},
			}
		);

		const payload = await response.text();
		if (!response.ok) {
			logger.warn("klines.proxy-upstream-error", {
				symbol,
				interval,
				startTime,
				endTime,
				statusCode: response.status,
			});
			return res.status(response.status).json({
				success: false,
				message: "Failed to fetch candles from Backpack",
			});
		}

		res.setHeader("Content-Type", "application/json");
		return res.status(200).send(payload);
	} catch (error) {
		logger.errorWithCause("klines.proxy-failed", error);
		return res.status(502).json({
			success: false,
			message: "Failed to load candles",
		});
	}
};

const stream = async (req: Request, res: Response) => {
	const user = (req as extendedRequest).user;

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders();

	writeSseEvent(res, "connected", {
		message: "SSE connection established",
		userId: user.id,
	});
	logger.info("prices.stream.connected", {
		userId: user.id,
	});

	const priceRedis = createRedisClient();
	let closed = false;
	let lastPriceStreamId = "$";

	const unsubscribeCallback = registerCallbackHandler((event: TradeCallbackEvent) => {
		if (closed) return;

		if (event.userId && event.userId !== user.id) {
			return;
		}

		writeSseEvent(res, "trade", event);
		logger.debug("prices.stream.trade-forwarded", {
			userId: user.id,
			eventType: event.type,
			orderId: event.orderId,
		});
	});

	const keepAliveTimer = setInterval(() => {
		if (!closed) {
			res.write(": keepalive\n\n");
		}
	}, 15000);

	const cleanup = () => {
		if (closed) {
			return;
		}

		closed = true;
		clearInterval(keepAliveTimer);
		unsubscribeCallback();
		priceRedis.disconnect();
		logger.info("prices.stream.disconnected", {
			userId: user.id,
		});
	};

	req.on("close", cleanup);

	(async () => {
		while (!closed) {
			try {
				const streamData = await priceRedis.xread(
					"BLOCK",
					5000,
					"STREAMS",
					PRICE_STREAM,
					lastPriceStreamId
				);

				if (!streamData?.[0]) {
					continue;
				}

				for (const [, messages] of streamData) {
					for (const [messageId, fields] of messages) {
						lastPriceStreamId = messageId;

						const priceUpdatesRaw = getFieldValue(
							fields as string[],
							"priceUpdates"
						);
						if (!priceUpdatesRaw) {
							continue;
						}

						const priceUpdates = JSON.parse(priceUpdatesRaw) as PriceUpdate[];
						writeSseEvent(res, "price", {
							updates: priceUpdates,
						});
					}
				}
			} catch (error) {
				if (closed) {
					break;
				}
				logger.errorWithCause("prices.stream.redis-read-failed", error, {
					userId: user.id,
				});
				writeSseEvent(res, "error", {
					message: "Price stream temporarily unavailable",
				});
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}
	})().catch((error) => {
		logger.errorWithCause("prices.stream.fatal-loop-error", error, {
			userId: user.id,
		});
		cleanup();
	});
};

export const pricesController = {
	klines,
	stream,
};
