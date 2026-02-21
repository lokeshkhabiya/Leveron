import redis from "@leveron/redis";
import prisma from "@leveron/db";
import { type PriceUpdate, type PriceUpdates } from "@leveron/poller";
import type {
    Asset,
    CloseReason,
    openOrder,
    orderSide,
    userBalance,
} from "./types";
import { createLogger } from "./logger";

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
let assetOrderIndex: Map<Asset, Set<string>> = new Map();

let lastPriceStreamId = "0";
let lastOrdersStreamId = "0";
const CALLBACK_QUEUE = "callback-queue";
const assetIdCache: Map<Asset, string> = new Map();
const logger = createLogger("engine.core");
const ASSET_METADATA: Record<Asset, { name: string; imageUrl: string }> = {
    BTC: {
        name: "Bitcoin",
        imageUrl: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
    },
    ETH: {
        name: "Ethereum",
        imageUrl: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
    },
    SOL: {
        name: "Solana",
        imageUrl: "https://assets.coingecko.com/coins/images/4128/large/solana.png",
    },
};

type CallbackEventType = "TRADE_OPENED" | "TRADE_CLOSED" | "TRADE_ERROR";

type CallbackPayload = {
    type: CallbackEventType;
    orderId: string;
    userId?: string;
    asset?: Asset;
    status?: "OPEN" | "CLOSED" | "LIQUIDATED";
    reason?: CloseReason;
    entryPrice?: number;
    closePrice?: number;
    pnl?: number;
    message?: string;
};

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

function getCloseStatus(reason: CloseReason): "CLOSED" | "LIQUIDATED" {
    return reason === "LIQUIDATION" ? "LIQUIDATED" : "CLOSED";
}

function isUniqueOrderIdConstraintError(error: unknown) {
    if (!(error instanceof Error)) {
        return false;
    }

    return (
        error.message.includes("Unique constraint failed") &&
        error.message.includes("id")
    );
}

function isAssetSymbol(value: string): value is Asset {
    return value === "BTC" || value === "ETH" || value === "SOL";
}

async function getOpenOrderForClose(orderId: string): Promise<openOrder | null> {
    const inMemory = openOrders.get(orderId);
    if (inMemory) {
        return inMemory;
    }

    const dbOrder = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
            id: true,
            userId: true,
            side: true,
            quantity: true,
            entryPrice: true,
            leverage: true,
            margin: true,
            status: true,
            takeProfit: true,
            stopLoss: true,
            liquidationPrice: true,
            createdAt: true,
            updatedAt: true,
            asset: {
                select: {
                    symbol: true,
                },
            },
        },
    });

    if (!dbOrder) {
        logger.warn("trade.close-order-missing", { orderId });
        return null;
    }

    if (dbOrder.status !== "OPEN") {
        logger.info("trade.close-order-already-finalized", {
            orderId,
            status: dbOrder.status,
        });
        return null;
    }

    if (!isAssetSymbol(dbOrder.asset.symbol)) {
        throw new Error(`Unsupported asset symbol: ${dbOrder.asset.symbol}`);
    }

    const reconstructed: openOrder = {
        orderId: dbOrder.id,
        userId: dbOrder.userId,
        asset: dbOrder.asset.symbol,
        side: dbOrder.side,
        quantity: dbOrder.quantity,
        entryPrice: dbOrder.entryPrice,
        leverage: dbOrder.leverage,
        margin: dbOrder.margin,
        status: "OPEN",
        takeProfit: dbOrder.takeProfit ?? undefined,
        stopLoss: dbOrder.stopLoss ?? undefined,
        liquidationPrice: dbOrder.liquidationPrice,
        createdAt: dbOrder.createdAt,
        updatedAt: dbOrder.updatedAt,
    };

    openOrders.set(orderId, reconstructed);
    if (!userOrderIndex.has(reconstructed.userId)) {
        userOrderIndex.set(reconstructed.userId, new Set());
    }
    userOrderIndex.get(reconstructed.userId)!.add(orderId);

    if (!assetOrderIndex.has(reconstructed.asset)) {
        assetOrderIndex.set(reconstructed.asset, new Set());
    }
    assetOrderIndex.get(reconstructed.asset)!.add(orderId);

    logger.info("trade.close-order-rehydrated-from-db", {
        orderId,
        userId: reconstructed.userId,
        asset: reconstructed.asset,
    });

    return reconstructed;
}

async function getAssetId(symbol: Asset): Promise<string> {
    const cachedId = assetIdCache.get(symbol);
    if (cachedId) {
        return cachedId;
    }

    const metadata = ASSET_METADATA[symbol];
    const asset = await prisma.asset.upsert({
        where: { symbol },
        create: {
            symbol,
            name: metadata.name,
            imageUrl: metadata.imageUrl,
        },
        update: {},
        select: { id: true },
    });

    assetIdCache.set(symbol, asset.id);
    logger.debug("asset.id-resolved", {
        symbol,
        assetId: asset.id,
    });
    return asset.id;
}

async function publishCallback(payload: CallbackPayload): Promise<void> {
    try {
        await redis.xadd(
            CALLBACK_QUEUE,
            "*",
            "event",
            JSON.stringify({
                ...payload,
                timestamp: new Date().toISOString(),
            })
        );
    } catch (error) {
        logger.errorWithCause("callback.publish-failed", error, {
            orderId: payload.orderId,
            type: payload.type,
            userId: payload.userId,
        });
    }
}

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
        logger.info("balance.initialized", {
            userId,
            balance: defaultBalance,
        });
        return defaultBalance;
    }

    return JSON.parse(balanceData) as userBalance;
}

async function getOrLoadUserBalance(userId: string): Promise<userBalance> {
    let balance = balances.get(userId);
    if (!balance) {
        balance = await loadUserBalance(userId);
        balances.set(userId, balance);
    }
    return balance;
}

// helper function to update balance in redis.
async function updateBalanceInRedis(userId: string, balance: userBalance) {
    await redis.hset(`balances`, userId, JSON.stringify(balance));
    logger.debug("balance.persisted", {
        userId,
        available: balance.available,
        locked: balance.locked,
        total: balance.total,
    });
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

async function checkAndTriggerTakeProfit_StopLoss(
    asset: Asset,
    markPrice: number
): Promise<void> {
    const ordersForAsset = assetOrderIndex.get(asset);

    if (!ordersForAsset || ordersForAsset.size === 0) {
        return;
    }

    for (const orderId of ordersForAsset) {
        const order = openOrders.get(orderId);

        if (!order || order.status !== "OPEN") continue;

        let shouldClose = false;
        let reason: CloseReason | null = null;

        if (order.side === "LONG") {
            if (order.takeProfit && markPrice >= order.takeProfit) {
                shouldClose = true;
                reason = "TAKE_PROFIT";
            } else if (order.stopLoss && markPrice <= order.stopLoss) {
                shouldClose = true;
                reason = "STOP_LOSS";
            }
        } else {
            if (order.takeProfit && markPrice <= order.takeProfit) {
                shouldClose = true;
                reason = "TAKE_PROFIT";
            } else if (order.stopLoss && markPrice >= order.stopLoss) {
                shouldClose = true;
                reason = "STOP_LOSS";
            }
        }

        if (shouldClose && reason) {
            try {
                await processCloseTrade(orderId, reason); 
            } catch (error) {
                logger.errorWithCause("trade.close-tp-sl-failed", error, {
                    orderId,
                    reason,
                });
            }
        }
    }
}

// Helper to convert currentPrices to Map<Asset, number> for calculations
function getMarkPricesMap(): Map<Asset, number> {
    const markPrices = new Map<Asset, number>();
    for (const [asset, priceUpdate] of currentPrices.entries()) {
        markPrices.set(asset as Asset, parseFloat(priceUpdate.price));
    }
    return markPrices;
} 


async function checkAndTriggerLiquidation() {
    const markPrices = getMarkPricesMap(); 

    const userOrdersMap = new Map<string, openOrder[]>(); 

    for (const order of openOrders.values()) {
        if (order.status !== "OPEN") continue; 
        
        if (!userOrdersMap.has(order.userId)) {
            userOrdersMap.set(order.userId, []); 
        }

        userOrdersMap.get(order.userId)!.push(order); 
    }

    // check each user's positions 
    for (const [userId, orders] of userOrdersMap.entries()) {
        if (orders.length === 0) continue; 

        const balance = await getOrLoadUserBalance(userId); 

        // calculate equity and used margin 
        const equity = calculateEquity(balance, orders, markPrices); 
        const usedMargin = orders.reduce((sum, order) => sum + order.margin, 0); 

        // check if liquidation required or not - equity <= 0 ( 100% loss )
        const minEquityRequired = usedMargin * ASSET_CONFIG[orders[0]!.asset].maintenanceMarginRate;

        if (equity <= minEquityRequired || equity <= 0) {
            logger.warn("risk.user-liquidation-required", {
                userId,
                equity,
                usedMargin,
                minEquityRequired,
            });

            // Prioritize liquidating the worst losing positions first.
            const ordersWithPnl = orders
                .map((order) => {
                    const markPrice = markPrices.get(order.asset);
                    if (markPrice === undefined) {
                        return null;
                    }

                    return {
                        order,
                        pnl: calculatePnl(order, markPrice),
                    };
                })
                .filter(
                    (
                        value
                    ): value is {
                        order: openOrder;
                        pnl: number;
                    } => value !== null
                )
                .sort((a, b) => a.pnl - b.pnl);

            for (const { order } of ordersWithPnl) {
                if (!openOrders.has(order.orderId)) {
                    continue;
                }

                try {
                    await processCloseTrade(order.orderId, "LIQUIDATION");
                } catch (error) {
                    logger.errorWithCause("risk.liquidation-failed", error, {
                        orderId: order.orderId,
                        userId: order.userId,
                    });
                }
            }
        }

    }
}

let lastCloseOrdersStreamId = "0"; 

async function processStreamMessages() {
    if (!isRedisConnected) {
        logger.warn("stream.redis-disconnected-waiting");
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
            "close-orders-stream",
            lastPriceStreamId,
            lastOrdersStreamId,
            lastCloseOrdersStreamId,
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

                                const markPrice = parseFloat(update.price);
                                await checkAndTriggerTakeProfit_StopLoss(update.asset as Asset, markPrice);
                            }

                            // after all prices updates, check for liquidations 
                            await checkAndTriggerLiquidation(); 

                            logger.debug("stream.prices-processed", {
                                count: priceUpdates.length,
                            });
                        } else if (streamName === "orders-stream") {
                            lastOrdersStreamId = id;
                            const openTradeData = JSON.parse(
                                fields[1] as string
                            );

                            logger.info("stream.open-order-message", {
                                orderId: openTradeData.orderId,
                                userId: openTradeData.userId,
                                asset: openTradeData.asset,
                            });

                            await processOpenTrade(openTradeData);
                        } else if (streamName === "close-orders-stream") {
                            // handle close orders 
                            lastCloseOrdersStreamId = id;
                            const closeOrderData = JSON.parse(
                                fields[1] as string 
                            ) as { orderId: string; userId: string };

                            logger.info("stream.close-order-message", {
                                orderId: closeOrderData.orderId,
                                userId: closeOrderData.userId,
                            });

                            await processCloseTrade(
                                closeOrderData.orderId,
                                "USER",
                                closeOrderData.userId
                            );
                        }
                    } catch (error) {
                        logger.errorWithCause("stream.message-processing-failed", error, {
                            stream: streamName,
                            messageId: id,
                        });
                    }
                }
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes("Connection")) {
            logger.errorWithCause("stream.redis-connection-error", error, {
                message: error.message,
            });
            isRedisConnected = false;
        } else {
            logger.errorWithCause("stream.read-failed", error);
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
    let balance: userBalance | null = null;
    let balanceAdjusted = false;
    let requiredAvailable = 0;

    try {
        const existingOrder = await prisma.order.findUnique({
            where: { id: openTradeData.orderId },
            select: { id: true, status: true },
        });

        if (existingOrder) {
            logger.warn("trade.open-duplicate-skipped", {
                orderId: openTradeData.orderId,
                userId: openTradeData.userId,
                status: existingOrder.status,
            });
            return;
        }

        const priceUpdate = currentPrices.get(openTradeData.asset);
        if (!priceUpdate) {
            throw new Error(
                `No current price available for asset: ${openTradeData.asset}`
            );
        }

        const asset = openTradeData.asset as Asset;
        const currentPrice = parseFloat(priceUpdate.price);

        // 1) Load balance and validate leverage/position size
        balance = await loadUserBalance(openTradeData.userId);

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
        requiredAvailable = openTradeData.margin + openFee;

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
        balanceAdjusted = true;
        logger.info("balance.locked-for-open-trade", {
            orderId: openTradeData.orderId,
            userId: openTradeData.userId,
            margin: openTradeData.margin,
            openFee,
            available: balance.available,
            locked: balance.locked,
            total: balance.total,
        });

        openOrders.set(openTradeData.orderId, openOrder);

        if (!userOrderIndex.has(openOrder.userId)) {
            userOrderIndex.set(openOrder.userId, new Set());
        }
        userOrderIndex.get(openOrder.userId)!.add(openOrder.orderId);

        // maintain asset index
        if (!assetOrderIndex.has(openOrder.asset)) {
            assetOrderIndex.set(openOrder.asset, new Set());
        }

        assetOrderIndex.get(openOrder.asset)!.add(openOrder.orderId);

        const assetId = await getAssetId(openOrder.asset);

        await prisma.order.create({
            data: {
                id: openOrder.orderId,
                userId: openOrder.userId,
                assetId,
                side: openOrder.side,
                quantity: openOrder.quantity,
                margin: openOrder.margin,
                leverage: openOrder.leverage,
                entryPrice: openOrder.entryPrice,
                status: "OPEN",
                closeReason: null,
                takeProfit: openOrder.takeProfit ?? null,
                stopLoss: openOrder.stopLoss ?? null,
                liquidationPrice: openOrder.liquidationPrice,
                createdAt: openOrder.createdAt,
                updatedAt: openOrder.updatedAt,
                closedAt: null,
                closePrice: null,
                pnl: null,
            },
        });

        await publishCallback({
            type: "TRADE_OPENED",
            orderId: openOrder.orderId,
            userId: openOrder.userId,
            asset: openOrder.asset,
            status: "OPEN",
            entryPrice: openOrder.entryPrice,
        });

        logger.info("trade.opened", {
            orderId: openTradeData.orderId,
            userId: openTradeData.userId,
            asset: openOrder.asset,
            entryPrice: openOrder.entryPrice,
            quantity: openOrder.quantity,
        });
    } catch (error) {
        if (balanceAdjusted && balance) {
            balance.available += requiredAvailable;
            balance.locked = Math.max(0, balance.locked - openTradeData.margin);
            balance.total = balance.available + balance.locked;

            balances.set(openTradeData.userId, balance);
            try {
                await updateBalanceInRedis(openTradeData.userId, balance);
                logger.warn("balance.rollback-open-trade", {
                    orderId: openTradeData.orderId,
                    userId: openTradeData.userId,
                    available: balance.available,
                    locked: balance.locked,
                    total: balance.total,
                });
            } catch (rollbackError) {
                logger.errorWithCause("balance.rollback-open-trade-failed", rollbackError, {
                    orderId: openTradeData.orderId,
                    userId: openTradeData.userId,
                });
            }
        }

        if (isUniqueOrderIdConstraintError(error)) {
            logger.warn("trade.open-duplicate-after-race", {
                orderId: openTradeData.orderId,
                userId: openTradeData.userId,
            });
            return;
        }

        await publishCallback({
            type: "TRADE_ERROR",
            orderId: openTradeData.orderId,
            userId: openTradeData.userId,
            asset: openTradeData.asset as Asset,
            message:
                error instanceof Error
                    ? error.message
                    : "Unknown error while opening trade",
        });

        logger.errorWithCause("trade.open-failed", error, {
            orderId: openTradeData.orderId,
            userId: openTradeData.userId,
            asset: openTradeData.asset,
        });
        throw error;
    }
}

async function processCloseTrade(
    orderId: string,
    reason: CloseReason,
    requestedByUserId?: string
): Promise<void> {
    let order: openOrder | null = null;

    try {
        order = await getOpenOrderForClose(orderId);

        if (!order) {
            return;
        }

        if (requestedByUserId && order.userId !== requestedByUserId) {
            throw new Error("Order ownership mismatch");
        }

        const priceUpdate = currentPrices.get(order.asset);
        if (!priceUpdate) {
            throw new Error(`No current price available for asset: ${order.asset}`);
        }

        const markPrice = parseFloat(priceUpdate.price);

        // 1. compute pnl
        const pnl = calculatePnl(order, markPrice);
        const closeFee = calculateFee(order, markPrice, "CLOSE");

        // 2. load user balance
        const balance = await getOrLoadUserBalance(order.userId);

        // 3. unlock margin and realized pnl - fees
        balance.locked -= order.margin;
        if (balance.locked < 0) {
            balance.locked = 0;
        }

        const realizedAmount = order.margin + pnl - closeFee;
        balance.available += realizedAmount;
        balance.total = balance.available + balance.locked;

        balances.set(order.userId, balance);
        await updateBalanceInRedis(order.userId, balance);
        logger.info("balance.released-for-close-trade", {
            orderId,
            userId: order.userId,
            reason,
            realizedAmount,
            closeFee,
            available: balance.available,
            locked: balance.locked,
            total: balance.total,
        });

        // 4. update order state
        const now = new Date();
        const closeStatus = getCloseStatus(reason);
        order.status = closeStatus;
        order.updatedAt = now;

        await prisma.order.update({
            where: { id: order.orderId },
            data: {
                closePrice: markPrice,
                pnl,
                status: closeStatus,
                closeReason: reason,
                updatedAt: now,
                closedAt: now,
            },
        });

        // 5. remove order from openOrders and index
        openOrders.delete(orderId);

        const userOrders = userOrderIndex.get(order.userId);
        if (userOrders) {
            userOrders.delete(orderId);
            if (userOrders.size === 0) {
                userOrderIndex.delete(order.userId);
            }
        }

        const assetOrders = assetOrderIndex.get(order.asset);
        if (assetOrders) {
            assetOrders.delete(orderId);
            if (assetOrders.size === 0) {
                assetOrderIndex.delete(order.asset);
            }
        }

        await publishCallback({
            type: "TRADE_CLOSED",
            orderId,
            userId: order.userId,
            asset: order.asset,
            reason,
            status: closeStatus,
            closePrice: markPrice,
            pnl,
        });

        logger.info("trade.closed", {
            orderId,
            userId: order.userId,
            reason,
            status: closeStatus,
            closePrice: markPrice,
            pnl,
            closeFee,
        });
    } catch (error) {
        await publishCallback({
            type: "TRADE_ERROR",
            orderId,
            userId: requestedByUserId ?? order?.userId,
            asset: order?.asset,
            reason,
            message:
                error instanceof Error
                    ? error.message
                    : "Unknown error while closing trade",
        });

        logger.errorWithCause("trade.close-failed", error, {
            orderId,
            reason,
            requestedByUserId,
            orderUserId: order?.userId,
        });

        throw error;
    }
}

async function startEngine() {
    logger.info("engine.starting");

    if (!isRedisConnected) {
        logger.info("engine.waiting-for-redis");
        await new Promise((resolve) => {
            redis.once("connect", resolve);
        });
    }

    while (true) {
        await processStreamMessages();
    }
}

function shutdown() {
    logger.warn("engine.shutdown");
    redis.disconnect();
    process.exit(0);
}

startEngine().catch((error) => {
    logger.errorWithCause("engine.fatal-error", error);
    process.exit(1);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
