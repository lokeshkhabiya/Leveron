import type { extendedRequest } from "@/middleware/auth.middleware";
import { AddCloseTradeToEngine, AddOpenTradeToEngine } from "@/services/trades.service";
import { createLogger } from "@/utils/logger";
import prisma from "@leveron/db";
import type { Request, Response } from "express";
import z from "zod";

const createTradeSchema = z.object({
	asset: z.enum(["BTC", "SOL", "ETH"]),
	side: z.enum(["LONG", "SHORT"]),
	margin: z.coerce.number().positive(),
	leverage: z.coerce.number().int().positive(),
	takeProfit: z.coerce.number().positive().optional(),
	stopLoss: z.coerce.number().positive().optional(),
	slippage: z.coerce.number().int().min(0).max(100),
});

const closeTradeSchema = z.object({
	orderId: z.string().uuid(),
});

const getOrderParamsSchema = z.object({
	orderId: z.string().uuid(),
});

const orderStatusSchema = z.enum(["OPEN", "CLOSED", "LIQUIDATED"]);
const logger = createLogger("server.trade-controller");

function isRedisUnavailableError(error: unknown) {
	return (
		error instanceof Error &&
		error.message.toLowerCase().includes("redis not connected")
	);
}

const createTrade = async (req: Request, res: Response) => {
	try {
		const user = (req as extendedRequest).user;
		const userId = user.id;

		const { success, error, data } = createTradeSchema.safeParse(req.body);

		if (!success) {
			logger.warn("trade.create.invalid-payload", {
				userId,
				error: error.flatten(),
			});
			return res.status(400).json({
				success: false,
				message: "Invalid trade payload",
				error,
			});
		}

		const { asset, side, margin, leverage, slippage, takeProfit, stopLoss } = data;

		const orderId = crypto.randomUUID();
		logger.info("trade.create.accepted", {
			orderId,
			userId,
			asset,
			side,
			margin,
			leverage,
		});

		await AddOpenTradeToEngine(
			orderId,
			userId,
			asset,
			side,
			margin,
			leverage,
			slippage,
			takeProfit ?? 0,
			stopLoss ?? 0,
		);

		return res.status(202).json({
			success: true, 
			orderId,  
		});
	} catch (error) {
		if (isRedisUnavailableError(error)) {
			logger.errorWithCause("trade.create.redis-unavailable", error);
			return res.status(503).json({
				success: false,
				message: "Trading service is temporarily unavailable",
			});
		}

		logger.errorWithCause("trade.create.failed", error);
		return res.status(500).json({
			success: false, 
			message: "Internal server error",
		});
	}
};

const closeTrade = async (req: Request, res: Response) => {
	try {
		const user = (req as extendedRequest).user;
		const userId = user.id;

		const { success, error, data } = closeTradeSchema.safeParse(req.body);

		if (!success) {
			logger.warn("trade.close.invalid-payload", {
				userId,
				error: error.flatten(),
			});
			return res.status(400).json({
				success: false,
				message: "Invalid close payload",
				error,
			});
		}

		const { orderId } = data;
		const order = await prisma.order.findFirst({
			where: {
				id: orderId,
				userId,
				status: "OPEN",
			},
			select: {
				id: true,
			},
		});

		if (!order) {
			logger.warn("trade.close.order-not-open", {
				userId,
				orderId,
			});
			return res.status(404).json({
				success: false,
				message: "Open order not found",
			});
		}

		await AddCloseTradeToEngine(orderId, userId);
		logger.info("trade.close.accepted", {
			orderId,
			userId,
		});

		return res.status(202).json({
			success: true,
			message: "Close request accepted",
			orderId,
		});
	} catch (error) {
		if (isRedisUnavailableError(error)) {
			logger.errorWithCause("trade.close.redis-unavailable", error);
			return res.status(503).json({
				success: false,
				message: "Trading service is temporarily unavailable",
			});
		}

		logger.errorWithCause("trade.close.failed", error);
		return res.status(500).json({
			success: false,
			message: "Internal server error",
		});
	}
};

const getOrders = async (req: Request, res: Response) => {
    try {
        const user = (req as extendedRequest).user;
        const userId = user.id;

        const statusQuery = req.query.status;
        const status =
            typeof statusQuery === "string" ? statusQuery.toUpperCase() : undefined;

        if (status) {
            const { success, error } = orderStatusSchema.safeParse(status);
            if (!success) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid status filter",
                    error,
                });
            }
        }

        const orders = await prisma.order.findMany({
            where: {
                userId,
                status: status as "OPEN" | "CLOSED" | "LIQUIDATED" | undefined,
            },
            include: {
                asset: {
                    select: {
                        id: true,
                        symbol: true,
                        name: true,
                        imageUrl: true,
                    },
                },
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        return res.status(200).json({
            success: true,
            orders,
        });
    } catch (error) {
        logger.errorWithCause("trade.orders.fetch-failed", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

const getOrder = async (req: Request, res: Response) => {
    try {
        const user = (req as extendedRequest).user;
        const userId = user.id;

        const { success, error, data } = getOrderParamsSchema.safeParse(req.params);
        if (!success) {
            return res.status(400).json({
                success: false,
                message: "Invalid order id",
                error,
            });
        }

        const order = await prisma.order.findFirst({
            where: {
                id: data.orderId,
                userId,
            },
            include: {
                asset: {
                    select: {
                        id: true,
                        symbol: true,
                        name: true,
                        imageUrl: true,
                    },
                },
            },
        });

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Order not found",
            });
        }

        return res.status(200).json({
            success: true,
            order,
        });
    } catch (error) {
        logger.errorWithCause("trade.order.fetch-failed", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
        });
    }
};

export const tradeController = {
    createTrade,
    closeTrade,
    getOrders,
    getOrder,
};
