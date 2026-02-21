import { createRedisClient } from "@leveron/redis";
import { createLogger } from "@/utils/logger";

const CALLBACK_STREAM = "callback-queue";
const logger = createLogger("server.callback-service");

export type TradeCallbackEvent = {
	type: "TRADE_OPENED" | "TRADE_CLOSED" | "TRADE_ERROR";
	orderId: string;
	userId?: string;
	asset?: string;
	status?: "OPEN" | "CLOSED" | "LIQUIDATED";
	reason?: "USER" | "TAKE_PROFIT" | "STOP_LOSS" | "LIQUIDATION";
	entryPrice?: number;
	closePrice?: number;
	pnl?: number;
	message?: string;
	timestamp?: string;
};

type CallbackHandler = (event: TradeCallbackEvent) => void;

const handlers = new Set<CallbackHandler>();
let listenerStarted = false;
let lastCallbackStreamId = "$";

function getFieldValue(fields: string[], key: string): string | null {
	for (let index = 0; index < fields.length; index += 2) {
		if (fields[index] === key) {
			return fields[index + 1] ?? null;
		}
	}

	return null;
}

function notifyHandlers(event: TradeCallbackEvent) {
	for (const handler of handlers) {
		try {
			handler(event);
		} catch (error) {
			logger.errorWithCause("callback.handler-error", error);
		}
	}
}

export function registerCallbackHandler(handler: CallbackHandler) {
	handlers.add(handler);

	return () => {
		handlers.delete(handler);
	};
}

export async function startCallbackListener() {
	if (listenerStarted) {
		return;
	}
	listenerStarted = true;

	const callbackRedis = createRedisClient();

	callbackRedis.on("error", (error) => {
		logger.errorWithCause("callback.redis-error", error);
	});

	logger.info("callback.listener-started", {
		startStreamId: lastCallbackStreamId,
	});

	while (true) {
		try {
			const streamData = await callbackRedis.xread(
				"BLOCK",
				5000,
				"STREAMS",
				CALLBACK_STREAM,
				lastCallbackStreamId
			);

			if (!streamData?.[0]) {
				continue;
			}

			for (const [, messages] of streamData) {
				for (const [messageId, fields] of messages) {
					lastCallbackStreamId = messageId;
					const eventRaw = getFieldValue(fields as string[], "event");

					if (!eventRaw) {
						continue;
					}

					try {
						const event = JSON.parse(eventRaw) as TradeCallbackEvent;
						logger.info("callback.event-received", {
							type: event.type,
							orderId: event.orderId,
							userId: event.userId,
						});
						notifyHandlers(event);
					} catch (error) {
						logger.errorWithCause(
							"callback.message-parse-failed",
							error,
							{ messageId },
						);
					}
				}
			}
		} catch (error) {
			logger.errorWithCause("callback.listener-loop-error", error);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}
}
