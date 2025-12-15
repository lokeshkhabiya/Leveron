import redis from "@leveron/redis";
import { type PriceUpdate, type PriceUpdates } from "@leveron/poller";
import type {
    Asset,
    CloseReason,
    openOrder,
    orderSide,
    userBalance,
} from "./types";

const ASSET_CONFIG: Record<
    Asset,
    {
        maxLeverage: number;
        minLeverage: number;
        initialMarginRate: number; // e.g. 10% => 0.10
        maintenanceMarginRate: number; // e.g. 5% => 0.05
        takerFeeRate: number; // per side, e.g. 0.0005 = 5 bps
    }
> = {
    BTC: {
        maxLeverage: 100,
        minLeverage: 1,
        initialMarginRate: 0.1,
        maintenanceMarginRate: 0.05,
        takerFeeRate: 0.0005,
    },
    ETH: {
        maxLeverage: 50,
        minLeverage: 1,
        initialMarginRate: 0.1,
        maintenanceMarginRate: 0.05,
        takerFeeRate: 0.0005,
    },
    SOL: {
        maxLeverage: 20,
        minLeverage: 1,
        initialMarginRate: 0.1,
        maintenanceMarginRate: 0.05,
        takerFeeRate: 0.0007,
    },
};

const GLOBAL_RISK_CONFIG = {
    maxPositionSizePctOfBalance: 0.1, // position notional <= 10% of balance
};

let isRedisConnected = false;
let currentPrices: PriceUpdates = new Map<string, PriceUpdate>();
let balances: Map<string, userBalance> = new Map();
let openOrders: Map<string, openOrder> = new Map();
let userOrderIndex: Map<string, Set<string>> = new Map();

let lastPriceStreamId = "0";
let lastOrdersStreamId = "0";

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

// function to load user balance from redis
async function loadUserBalance(userId: string): Promise<userBalance> {
    const balanceData = await redis.hget("balances", userId);

    if (!balanceData) {
        const defaultBalance: userBalance = {
            available: 5000,
            locked: 0,
            total: 5000,
        };

        await updateBalanceInRedis(userId, defaultBalance);
        return defaultBalance;
    }

    return JSON.parse(balanceData) as userBalance;
}

// helper function to update balance in redis.
async function updateBalanceInRedis(userId: string, balance: userBalance) {
    await redis.hset(`balances`, userId, JSON.stringify(balance));
}

// calculate entry price with slippage
function calculateEntryPrice(
    currentPrice: number,
    side: "LONG" | "SHORT",
    slippage: number
): number {
    const slippageMultiplier = slippage / 100;

    if (side === "LONG") {
        return currentPrice * (1 + slippageMultiplier);
    } else {
        return currentPrice * (1 - slippageMultiplier);
    }
}

// calculate quantity based on margin, leverage and entry price
function calculateQuantity(
    margin: number,
    leverage: number,
    entryPrice: number
): number {
    // position size
    return (margin * leverage) / entryPrice;
}

// caludate liquidation price
function calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    side: orderSide
) {
    if (leverage <= 0) {
        throw new Error("Leverage must be greater than 0");
    }

    if (side === "LONG") {
        // liquidation at 100% margin loss: Pliq = entry * (1 - 1 / leverage)
        return entryPrice * (1 - 1 / leverage);
    }

    // SHORT: Pliq = entry * (1 + 1 / leverage)
    return entryPrice * (1 + 1 / leverage);
}
// create openOrder object from openTrade data
function createOpenOrder(
    openTradeData: {
        orderId: string;
        userId: string;
        asset: string;
        side: "LONG" | "SHORT";
        margin: number;
        leverage: number;
        slippage: number;
        takeProfit?: number;
        stopLoss?: number;
    },
    entryPrice: number,
    quantity: number
): openOrder {
    const now = new Date();

    const liquidationPrice = calculateLiquidationPrice(
        entryPrice,
        openTradeData.leverage,
        openTradeData.side
    );

    return {
        orderId: openTradeData.orderId,
        userId: openTradeData.userId,
        asset: openTradeData.asset as Asset,
        side: openTradeData.side,
        quantity,
        entryPrice,
        leverage: openTradeData.leverage,
        margin: openTradeData.margin,
        liquidationPrice: liquidationPrice,
        takeProfit: openTradeData.takeProfit,
        stopLoss: openTradeData.stopLoss,
        status: "OPEN",
        createdAt: now,
        updatedAt: now,
    };
}

// pnl calculation
function calculatePnl(order: openOrder, markPrice: number): number {
    const { side, entryPrice, quantity } = order;

    if (quantity <= 0) {
        return 0;
    }

    if (side === "LONG") {
        return (markPrice - entryPrice) * quantity;
    } else {
        return (entryPrice - markPrice) * quantity;
    }
}

// equity calculation
function calculateEquity(
    balance: userBalance,
    openOrderForUser: openOrder[],
    markPrices: Map<Asset, number>
): number {
    let unrealizedPNL = 0;

    for (const order of openOrderForUser) {
        const markPrice = markPrices.get(order.asset);

        if (markPrice === undefined) continue;

        const pnl = calculatePnl(order, markPrice);
        unrealizedPNL += pnl;
    }

    return balance.total + unrealizedPNL;
}

// get maintainence margin - minimum equity to keep position open
function getMaintainenceMargin(order: openOrder): number {
    const config = ASSET_CONFIG[order.asset];
    return order.margin * config.maintenanceMarginRate;
}

function isLiquidationRequired(order: openOrder, userEquity: number): boolean {
    const maintainenceMargin = getMaintainenceMargin(order);
    return userEquity <= maintainenceMargin;
}

// validate leverage
function validateLeverage(leverage: number, asset: Asset): void {
    const config = ASSET_CONFIG[asset];

    if (leverage < config.minLeverage || leverage > config.maxLeverage) {
        throw new Error(
            `Invalid leverage ${leverage} for ${asset}. allowed range: ${config.minLeverage} - ${config.maxLeverage}`
        );
    }
}

function validatePositionSize(
    margin: number,
    leverage: number,
    balance: userBalance,
    asset: Asset
) {
    const notional = margin * leverage; // exposure
    const maxNotional =
        balance.total * GLOBAL_RISK_CONFIG.maxPositionSizePctOfBalance;

    if (notional > maxNotional) {
        throw new Error(
            `Position too large for ${asset}. Notional ${notional} exceeds max allowed ${maxNotional}`
        );
    }
}

function calculateFee(
    order: openOrder,
    price: number,
    action: "OPEN" | "CLOSE"
): number {
    const config = ASSET_CONFIG[order.asset];
    const notional = order.quantity * price;

    const rate = config.takerFeeRate;
    return notional * rate;
}

// update balance when opening a trade ( lock margin )
async function updateBalanceForOpenTrade(userId: string, margin: number) {
    let balance = balances.get(userId);

    if (!balance) {
        balance = await loadUserBalance(userId);
    }

    if (balance.available < margin) {
        throw new Error(
            `Insufficient balance. Available: ${balance.available}, Required: ${margin}`
        );
    }

    balance.available -= margin;
    balance.locked += margin;
    balance.total = balance.available + balance.locked;

    balances.set(userId, balance);

    await updateBalanceInRedis(userId, balance);
}

async function processStreamMessages() {
    if (!isRedisConnected) {
        console.warn("[engine] redis not connected, waiting...");
        await new Promise((resolve) => {
            redis.once("connect", resolve);
        });
    }

    try {
        const data = await redis.xread(
            "BLOCK",
            5000,
            "STREAMS",
            "engine-stream",
            "orders-stream",
            lastPriceStreamId,
            lastOrdersStreamId
        );

        if (data?.[0]) {
            for (const [streamName, messages] of data) {
                for (const [id, fields] of messages) {
                    try {
                        if (streamName === "engine-stream") {
                            lastPriceStreamId = id;
                            const priceUpdates = JSON.parse(
                                fields[1] as string
                            ) as PriceUpdate[];

                            for (const update of priceUpdates) {
                                currentPrices.set(update.asset, update);
                            }

                            console.log(
                                `[engine] Processed ${priceUpdates.length} price update(s). Current prices:`,
                                Array.from(currentPrices.values())
                            );
                        } else if (streamName === "orders-stream") {
                            lastOrdersStreamId = id;
                            const openTradeData = JSON.parse(
                                fields[1] as string
                            );

                            console.log(
                                `[engine] Processing new order:`,
                                openTradeData
                            );

                            await processOpenTrade(openTradeData);
                        }
                    } catch (error) {
                        console.log(
                            `[engine] Error processing message: ${id}:`,
                            error
                        );
                    }
                }
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes("Connection")) {
            console.error(
                "[engine] Redis connection error while processing stream data: ",
                error.message
            );
            isRedisConnected = false;
        } else {
            console.error("[engine] Error reading from stream: ", error);
        }
    }
}

async function processOpenTrade(openTradeData: {
    orderId: string;
    userId: string;
    asset: string;
    side: "LONG" | "SHORT";
    margin: number;
    leverage: number;
    slippage: number;
    takeProfit?: number;
    stopLoss?: number;
}): Promise<void> {
    try {
        const priceUpdate = currentPrices.get(openTradeData.asset);
        if (!priceUpdate) {
            throw new Error(
                `No current price available for asset: ${openTradeData.asset}`
            );
        }

        const asset = openTradeData.asset as Asset;
        const currentPrice = parseFloat(priceUpdate.price);

        // 1) Load balance and validate leverage/position size
        const balance = await loadUserBalance(openTradeData.userId);

        validateLeverage(openTradeData.leverage, asset);
        validatePositionSize(
            openTradeData.margin,
            openTradeData.leverage,
            balance,
            asset
        );

        // 2) Compute entry price and quantity
        const entryPrice = calculateEntryPrice(
            currentPrice,
            openTradeData.side,
            openTradeData.slippage
        );

        const quantity = calculateQuantity(
            openTradeData.margin,
            openTradeData.leverage,
            entryPrice
        );

        // 3) Build an order object (without mutating balance yet)
        const openOrder = createOpenOrder(openTradeData, entryPrice, quantity);

        // 4) Compute open fee and ensure sufficient balance
        const openFee = calculateFee(openOrder, entryPrice, "OPEN");
        const requiredAvailable = openTradeData.margin + openFee;

        if (balance.available < requiredAvailable) {
            throw new Error(
                `Insufficient balance. Available: ${balance.available}, Required (margin + fee): ${requiredAvailable}`
            );
        }

        // 5) Apply margin lock + fee to balance
        balance.available -= requiredAvailable;
        balance.locked += openTradeData.margin;
        balance.total = balance.available + balance.locked;

        balances.set(openTradeData.userId, balance);
        await updateBalanceInRedis(openTradeData.userId, balance);

        openOrders.set(openTradeData.orderId, openOrder);

        if (!userOrderIndex.has(openOrder.userId)) {
            userOrderIndex.set(openOrder.userId, new Set());
        }
        userOrderIndex.get(openOrder.userId)!.add(openOrder.orderId);

        console.log(
            `[engine] Open trade ${openTradeData.orderId} processed successfully.`
        );
    } catch (error) {
        console.error(
            `[engine] Error processing open trade ${openTradeData.orderId}:`,
            error
        );
        throw error;
    }
}

async function processCloseTrade(
    orderId: string,
    reason: CloseReason
): Promise<void> {
    
}

async function startEngine() {
    console.log("[engine] Starting price engine...");

    if (!isRedisConnected) {
        console.log("[engine] Waiting for redis connection...");
        await new Promise((resolve) => {
            redis.once("connect", resolve);
        });
    }

    while (true) {
        await processStreamMessages();
    }
}

function shutdown() {
    console.error("[engine] shutting down..");
    redis.disconnect();
    process.exit(0);
}

startEngine().catch((error) => {
    console.error("[engine] Fatal error: ", error);
    process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
