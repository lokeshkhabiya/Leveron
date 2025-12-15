import type { Request, Response } from "express";
import type { extendedRequest } from "@/middleware/auth.middleware";
import redis from "@leveron/redis"

const getBalance = async (req: Request, res: Response) => {
	try {
		const user = (req as extendedRequest).user;

		const balanceData = await redis.hget("balances", user.id);

		if (!balanceData) {
			const defaultBalance = {
				available: 5000, 
				locked: 0, 
				total: 5000
			}

			await redis.hset("balances", user.id, JSON.stringify(defaultBalance));

			return res.status(200).json({
				success: true, 
				message: "balance fetched successfully",
				data: defaultBalance
			})
		}

		const balance = JSON.parse(balanceData)
		return res.status(200).json({
			success: true,
			message: "balance fetched successfully",
			balance: balance
		})
	} catch (error) {
		console.error("error while getting balance: ", error);
		return res.status(500).json({
			success: false, 
			message: "Internal server error"
		})
	}
}

export const balanceController = {
	getBalance
}