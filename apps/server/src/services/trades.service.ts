import redis from "@leveron/redis";

let isRedisConnected = false; 

redis.on("connect", () => {
	console.log("[engine:redis] connected!");
	isRedisConnected = true;
});

redis.on("error", (error) => {
	console.error("[engine:redis] error:", error);
	isRedisConnected = false;
});

redis.on("close", () => {
	console.log("[engine:redis] connection closed");
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
		return; 
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
	}

	try {
		await redis.xadd(
			"orders-stream",
			"*",
			"openTrade",
			JSON.stringify(openTrade)
		)

		console.log(`[Open Trade]: new open trade: `, openTrade);
	} catch (error) {
		console.error("Error while adding open trade to engine");
	}

	return; 
}
