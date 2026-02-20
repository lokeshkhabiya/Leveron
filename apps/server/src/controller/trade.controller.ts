import type { extendedRequest } from "@/middleware/auth.middleware";
import { AddCloseTradeToEngine, AddOpenTradeToEngine } from "@/services/trades.service";
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
})

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

export const tradeController = {
    createTrade,
    closeTrade,
};
