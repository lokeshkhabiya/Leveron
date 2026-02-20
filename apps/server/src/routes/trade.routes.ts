import express, { Router } from "express";
import { tradeController } from "@/controller/trade.controller";
import authMiddleware from "@/middleware/auth.middleware";

const router: Router = express.Router();

router.post("/create", authMiddleware, tradeController.createTrade);
router.post("/close", authMiddleware, tradeController.closeTrade);
router.get("/orders", authMiddleware, tradeController.getOrders);
router.get("/orders/:orderId", authMiddleware, tradeController.getOrder);

export default router;
