import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";

import authRouter from "./routes/auth.routes";
import balanceRouter from "./routes/balance.routes";
import pricesRouter from "./routes/prices.routes";
import tradeRouter from "./routes/trade.routes";
import requestLogger from "./middleware/request-logger.middleware";
import { startCallbackListener } from "./services/callback.service";
import { createLogger } from "./utils/logger";

const app = express();
const logger = createLogger("server.app");

app.use(
	cors({
		origin: process.env.CORS_ORIGIN || "",
		methods: ["GET", "POST"],
		credentials: true,
	}),
);

app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

app.get("/", (_req, res) => {
	res.status(200).send("OK");
});

app.use("/api/auth", authRouter);
app.use("/api/balance", balanceRouter);	
app.use("/api/trade", tradeRouter);
app.use("/api/prices", pricesRouter);

const port = process.env.PORT || 8080;
app.listen(port, () => {
	void startCallbackListener();
	logger.info("server.started", {
		port: Number(port),
		corsOrigin: process.env.CORS_ORIGIN || "",
	});
});
