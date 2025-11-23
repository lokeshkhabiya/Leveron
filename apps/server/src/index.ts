import "dotenv/config";
import cors from "cors";
import express from "express";

import authRouter from "./routes/auth.routes";

const app = express();

app.use(
	cors({
		origin: process.env.CORS_ORIGIN || "",
		methods: ["GET", "POST", "OPTIONS"],
	}),
);

app.use(express.json());

app.get("/", (_req, res) => {
	res.status(200).send("OK");
});

app.use("/api/auth", authRouter);

const port = process.env.PORT || 8080;
app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});
