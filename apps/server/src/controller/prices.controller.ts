import { type extendedRequest } from "@/middleware/auth.middleware";
import {
	registerCallbackHandler,
	type TradeCallbackEvent,
} from "@/services/callback.service";
import { createRedisClient } from "@leveron/redis";
import type { Request, Response } from "express";

type PriceUpdate = {
	asset: string;
	price: string;
	timestamp: string;
};

const PRICE_STREAM = "engine-stream";

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

	const priceRedis = createRedisClient();
	let closed = false;
	let lastPriceStreamId = "$";

	const unsubscribeCallback = registerCallbackHandler((event: TradeCallbackEvent) => {
		if (closed) return;

		if (event.userId && event.userId !== user.id) {
			return;
		}

		writeSseEvent(res, "trade", event);
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
				console.error("[prices-controller] SSE price stream error:", error);
				writeSseEvent(res, "error", {
					message: "Price stream temporarily unavailable",
				});
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}
	})().catch((error) => {
		console.error("[prices-controller] SSE loop fatal error:", error);
		cleanup();
	});
};

export const pricesController = {
	stream,
};
