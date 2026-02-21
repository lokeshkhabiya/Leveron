import type { Request, Response } from "express";
import type { extendedRequest } from "@/middleware/auth.middleware";
import redis from "@leveron/redis";
import { createLogger } from "@/utils/logger";

const logger = createLogger("server.balance-controller");

const getBalance = async (req: Request, res: Response) => {
	try {
		const user = (req as extendedRequest).user;

		const balanceData = await redis.hget("balances", user.id);

		if (!balanceData) {
			const defaultBalance = {
				available: 5000,
				locked: 0,
				total: 5000,
			};

			await redis.hset("balances", user.id, JSON.stringify(defaultBalance));
			logger.info("balance.initialized", {
				userId: user.id,
				balance: defaultBalance,
			});

			return res.status(200).json({
				success: true,
				message: "balance fetched successfully",
				data: defaultBalance,
			});
		}

		const balance = JSON.parse(balanceData);
		return res.status(200).json({
			success: true,
			message: "balance fetched successfully",
			balance: balance,
		});
	} catch (error) {
		logger.errorWithCause("balance.fetch-failed", error);
		return res.status(500).json({
			success: false,
			message: "Internal server error",
		});
	}
};

export const balanceController = {
	getBalance,
};
