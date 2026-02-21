import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createLogger } from "@/utils/logger";

export interface extendedRequest extends Request {
	user: {
		id: string;
		email: string;
	};
}

const logger = createLogger("server.auth-middleware");

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
	const token = req.cookies["leveron_token"];
	if (!token) {
		logger.warn("auth.missing-token", {
			path: req.originalUrl,
			method: req.method,
		});
		return res.status(401).json({
			success: false,
			message: "Unauthorized",
		});
	}

	let decoded: unknown;
	try {
		decoded = jwt.verify(token, process.env.JWT_SECRET!);
	} catch (error) {
		logger.warn("auth.invalid-token", {
			path: req.originalUrl,
			method: req.method,
			error: error instanceof Error ? error.message : String(error),
		});
		return res.status(401).json({
			success: false,
			message: "Unauthorized",
		});
	}

	(req as extendedRequest).user = decoded as {
		id: string;
		email: string;
		username: string;
	};
	next();
};

export default authMiddleware;
