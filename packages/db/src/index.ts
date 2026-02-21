import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../prisma/generated/client";
import { PrismaPg } from "@prisma/adapter-pg";

function ensureDatabaseEnvLoaded() {
	if (process.env.DATABASE_URL) {
		return;
	}

	const candidates = [
		path.resolve(process.cwd(), ".env"),
		path.resolve(process.cwd(), "../server/.env"),
		path.resolve(process.cwd(), "../../apps/server/.env"),
		path.resolve(process.cwd(), "../.env"),
		path.resolve(process.cwd(), "../../.env"),
	];

	for (const candidate of candidates) {
		if (!fs.existsSync(candidate)) {
			continue;
		}

		loadEnv({ path: candidate, override: false });
		if (process.env.DATABASE_URL) {
			break;
		}
	}
}

ensureDatabaseEnvLoaded();

const adapter = new PrismaPg({
	connectionString: process.env.DATABASE_URL || "",
});
const prisma = new PrismaClient({ adapter });

export default prisma;
