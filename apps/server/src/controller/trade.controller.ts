import type { extendedRequest } from "@/middleware/auth.middleware";
import { AddCloseTradeToEngine, AddOpenTradeToEngine } from "@/services/trades.service";
import prisma from "@leveron/db";
import type { Request, Response } from "express";
import z from "zod";

const createTradeSchema = z.object({
    asset: z.enum(["BTC", "SOL", "ETH"]),
    side: z.enum(["LONG", "SHORT"]),
    margin: z.number(),
    leverage: z.number().int(),
    takeProfit: z.float32().optional(), 
    stopLoss: z.float32().optional(),
    slippage: z.number().int(),
});

const closeTradeSchema = z.object({
    orderId: z.string().uuid() 
});

const getOrderParamsSchema = z.object({
    orderId: z.string().uuid(),
});

const orderStatusSchema = z.enum(["OPEN", "CLOSED", "LIQUIDATED"]);

const createTrade = async (req: Request, res: Response) => {
    try {
        const user = (req as extendedRequest).user;
        const userId = user.id;

        const { success, error, data } = createTradeSchema.safeParse(req.body);

        if (!success) {
            return res.status(400).json({
                success: false,
                message: "error while validating body: ",
                error,
            });
        }

        const { asset, side, margin, leverage, slippage, takeProfit, stopLoss } = data;

        const orderId = crypto.randomUUID();
        await AddOpenTradeToEngine(
            orderId,
            userId,
            asset,
            side,
            margin,
            leverage,
            slippage, 
            takeProfit ?? 0,
            stopLoss ?? 0
        );

        return res.status(202).json({ 
			success: true, 
			orderId,  
		});
    } catch (error) {
        console.error("Error while creating trade: ", error);
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
            return res.status(400).json({
                success: false, 
                message: "Error while validating body: ", 
                error, 
            })
        }

        const { orderId } = data; 

        await AddCloseTradeToEngine(orderId, userId);

        return res.status(200).json({
            success: true,
            message: "Trade closed successfully",
            orderId
        });
    } catch (error) {
        console.error("Error while closing trade: ", error);
        return res.status(500).json({
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
        console.error("Error while fetching orders:", error);
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
        console.error("Error while fetching order:", error);
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
