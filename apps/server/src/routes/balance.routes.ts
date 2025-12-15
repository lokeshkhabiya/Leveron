import express, { Router } from "express";
import { balanceController } from "@/controller/balance.controller";
import authMiddleware from "@/middleware/auth.middleware";

const router: Router = express.Router();

router.get("/", authMiddleware, balanceController.getBalance);

export default router;