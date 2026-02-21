import type { NextFunction, Request, Response } from "express";
import { createLogger } from "@/utils/logger";

const logger = createLogger("server.http");

export default function requestLogger(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	const startedAt = Date.now();
	const requestId = req.header("x-request-id") ?? crypto.randomUUID();

	res.setHeader("x-request-id", requestId);
	res.locals.requestId = requestId;

	res.on("finish", () => {
		const durationMs = Date.now() - startedAt;
		const userId =
			typeof (req as { user?: { id?: string } }).user?.id === "string"
				? (req as { user?: { id: string } }).user!.id
				: null;

		logger.info("request.completed", {
			requestId,
			method: req.method,
			path: req.originalUrl,
			statusCode: res.statusCode,
			durationMs,
			userId,
			ip: req.ip,
			userAgent: req.header("user-agent") ?? "",
		});
	});

	next();
}
