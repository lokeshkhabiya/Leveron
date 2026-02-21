import redis from "@leveron/redis";
import { createLogger } from "@/utils/logger";

let isRedisConnected = false;
const logger = createLogger("server.trade-queue");

redis.on("connect", () => {
	logger.info("redis.connected");
	isRedisConnected = true;
});

redis.on("error", (error) => {
	logger.errorWithCause("redis.error", error);
	isRedisConnected = false;
});

redis.on("close", () => {
	logger.warn("redis.closed");
	isRedisConnected = false;
});

export async function AddOpenTradeToEngine(
	orderId: string,
	userId: string,
	asset: string,
	side: "LONG" | "SHORT",
	margin: number,
	leverage: number,
	slippage: number,
	takeProfit: number,
	stopLoss: number,
) {
	if (!isRedisConnected) {
		throw new Error("Redis not connected");
	}

	const openTrade = {
		orderId,
		userId,
		asset,
		side,
		margin,
		leverage,
		slippage,
		takeProfit,
		stopLoss,
	};

	try {
		await redis.xadd("orders-stream", "*", "openTrade", JSON.stringify(openTrade));
		logger.info("order.enqueued", {
			orderId,
			userId,
			asset,
			side,
			margin,
			leverage,
		});
	} catch (error) {
		logger.errorWithCause("order.enqueue-failed", error, {
			orderId,
			userId,
		});
		throw error;
	}
}

export async function AddCloseTradeToEngine(orderId: string, userId: string) {
	if (!isRedisConnected) {
		throw new Error("Redis not connected");
	}

	const closeOrder = {
		orderId,
		userId,
	};

	try {
		await redis.xadd(
			"close-orders-stream",
			"*",
			"closeOrder",
			JSON.stringify(closeOrder),
		);
		logger.info("close-order.enqueued", {
			orderId,
			userId,
		});
	} catch (error) {
		logger.errorWithCause("close-order.enqueue-failed", error, {
			orderId,
			userId,
		});
		throw error;
	}
}
