import { authController } from "@/controller/auth.controller";
import express, { Router } from "express";

const router: Router = express.Router();

router.post("/login", authController.login);
router.get("/verify", authController.verify);

export default router;
