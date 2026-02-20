import Redis, { type RedisOptions } from "ioredis";

function getRedisConfig(): RedisOptions {
	const port = Number.parseInt(process.env.REDIS_PORT ?? "6379", 10);

	return {
		host: process.env.REDIS_HOST ?? "localhost",
		port: Number.isFinite(port) ? port : 6379,
	};
}

export function createRedisClient(overrides: RedisOptions = {}) {
	return new Redis({
		...getRedisConfig(),
		...overrides,
	});
}

const redis = createRedisClient();

export default redis;
