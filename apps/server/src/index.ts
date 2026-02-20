import "dotenv/config";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";

import authRouter from "./routes/auth.routes";
import balanceRouter from "./routes/balance.routes";
import tradeRouter from "./routes/trade.routes";
const app = express();

app.use(
	cors({
		origin: process.env.CORS_ORIGIN || "",
		methods: ["GET", "POST"],
		credentials: true,
	}),
);

app.use(express.json());
app.use(cookieParser());

app.get("/", (_req, res) => {
	res.status(200).send("OK");
});

app.use("/api/auth", authRouter);
app.use("/api/balance", balanceRouter);	
app.use("/api/trade", tradeRouter);

const port = process.env.PORT || 8080;
app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});
