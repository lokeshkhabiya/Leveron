import { pricesController } from "@/controller/prices.controller";
import authMiddleware from "@/middleware/auth.middleware";
import express, { Router } from "express";

const router: Router = express.Router();

router.get("/stream", authMiddleware, pricesController.stream);

export default router;
