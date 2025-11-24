import ws from "ws";
import redis from "@leveron/redis";

type PriceUpdate = {
    asset: string;
    price: string;
    timestamp: string;
};

type PriceUpdates = Map<string, PriceUpdate>;

const CONFIG = {
    WS_URL: "wss://ws.backpack.exchange/",
    ENGINE_QUEUE: "engine-stream",
    POLL_INTERVAL_MS: 100,
    SYMBOLS: ["BTC_USDC", "SOL_USDC", "ETH_USDC"] as const,
    ASSET_MAP: {
        BTC_USDC: "BTC",
        SOL_USDC: "SOL",
        ETH_USDC: "ETH",
    } as const,
} as const;

let wsClient: ws | null = null;
let pollInterval: NodeJS.Timeout | null = null;
let isRedisConnected = false;
const priceUpdates: PriceUpdates = new Map();

redis.on("connect", () => {
    console.log("[redis] connected!");
    isRedisConnected = true;
});

redis.on("error", (error) => {
    console.error("[redis] error:", error);
    isRedisConnected = false;
});

redis.on("close", () => {
    console.log("[redis] connection closed");
    isRedisConnected = false;
});

type BookTickerMessage = {
    data?: {
        s?: string;
        b?: string;
        E?: string;
    };
};

function handlePriceUpdate(symbol: string, price: string, timestamp: string) {
    const asset = CONFIG.ASSET_MAP[symbol as keyof typeof CONFIG.ASSET_MAP];
    if (!asset) return;

    priceUpdates.set(asset, {
        asset,
        price,
        timestamp,
    });
}

function processWebSocketMessage(data: unknown) {
    try {
        const message = data as BookTickerMessage;
        const symbol = message?.data?.s;
        const price = message?.data?.b;
        const timestamp = message?.data?.E;

        if (!symbol || !price || !timestamp) return;

        handlePriceUpdate(symbol, price, timestamp);
    } catch (error) {
        console.error("[poller] Error processing message:", error);
    }
}

function createWebSocket(): ws {
    const client = new ws(CONFIG.WS_URL);

    client.on("open", () => {
        console.log("[poller] WebSocket connected");
        const subscribeMessage = {
            id: 2,
            method: "SUBSCRIBE",
            params: CONFIG.SYMBOLS.map((s) => `bookTicker.${s}`),
        };
        client.send(JSON.stringify(subscribeMessage));
    });

    client.on("message", (raw: ws.RawData) => {
        try {
            const jsonString =
                typeof raw === "string"
                    ? raw
                    : Buffer.isBuffer(raw)
                    ? raw.toString("utf8")
                    : Buffer.concat(raw as Buffer[]).toString("utf8");
            processWebSocketMessage(JSON.parse(jsonString));
        } catch (error) {
            console.error("[poller] Error parsing message:", error);
        }
    });

    client.on("error", (error) => {
        console.error("[poller] WebSocket error:", error);
    });

    client.on("close", () => {
        console.log("[poller] WebSocket closed, reconnecting...");
        setTimeout(() => {
            wsClient = createWebSocket();
        }, 5000);
    });

    return client;
}

async function publishPriceUpdates() {
    if (!isRedisConnected) {
        console.warn("[poller] Redis not connected, skipping publish");
        return;
    }

    if (priceUpdates.size === 0) {
        return;
    }

    try {
        const updatesArray = Array.from(priceUpdates.values());
        await redis.xadd(
          CONFIG.ENGINE_QUEUE,
          "*",
          "priceUpdates",
          JSON.stringify(updatesArray)
        );
        // console.log("current prices: ", updatesArray);
    } catch (error) {
        console.error("[poller] Error publishing to Redis:", error);
    }
}

function startPoller() {
    if (!isRedisConnected) {
        console.log("[poller] Waiting for Redis connection...");
        redis.once("connect", () => {
            startPoller();
        });
        return;
    }

    console.log("[poller] Starting price poller");
    wsClient = createWebSocket();

    pollInterval = setInterval(() => {
        publishPriceUpdates();
    }, CONFIG.POLL_INTERVAL_MS);
}

function shutdown() {
    console.log("[poller] Shutting down...");

    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }

    if (wsClient) {
        wsClient.removeAllListeners("close");
        wsClient.close();
        wsClient = null;
    }

    redis.disconnect();
    process.exit(0);
}

startPoller();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
