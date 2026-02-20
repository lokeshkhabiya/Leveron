import { authController } from "@/controller/auth.controller";
import authMiddleware from "@/middleware/auth.middleware";
import express, { Router } from "express";

const router: Router = express.Router();

router.post("/login", authController.login);
router.get("/verify", authController.verify);
router.get("/me", authMiddleware, authController.me);
router.post("/logout", authMiddleware, authController.logout);

export default router;
