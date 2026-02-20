export type Asset = "BTC" | "ETH" | "SOL";

export type userBalance = {
	available: number; 
	locked: number; 
	total: number; 
}

export type orderSide = "LONG" | "SHORT";
export type orderStatus = "OPEN" | "CLOSED" | "LIQUIDATED";

export type openOrder = {
	orderId: string;
	userId: string; 
	asset: Asset;
	side: orderSide;
	quantity: number; 
	entryPrice: number; 
	leverage: number; 
	margin: number; 
	status: orderStatus;
	takeProfit?: number; 
	stopLoss?: number; 
	liquidationPrice: number; 
	createdAt: Date; 
	updatedAt: Date; 
}

export type CloseReason = "USER" | "TAKE_PROFIT" | "STOP_LOSS" | "LIQUIDATION";
