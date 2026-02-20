import prisma from "../src";

const ASSETS = [
	{
		symbol: "BTC",
		name: "Bitcoin",
		imageUrl: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
	},
	{
		symbol: "ETH",
		name: "Ethereum",
		imageUrl: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
	},
	{
		symbol: "SOL",
		name: "Solana",
		imageUrl: "https://assets.coingecko.com/coins/images/4128/large/solana.png",
	},
] as const;

async function main() {
	for (const asset of ASSETS) {
		const id = crypto.randomUUID();

		await prisma.$executeRawUnsafe(
			`
				INSERT INTO "Asset" ("id", "symbol", "imageUrl", "name")
				VALUES ($1, $2, $3, $4)
				ON CONFLICT ("symbol")
				DO UPDATE SET "imageUrl" = EXCLUDED."imageUrl", "name" = EXCLUDED."name"
			`,
			id,
			asset.symbol,
			asset.imageUrl,
			asset.name,
		);
	}

	console.log(`[db:seed] Seeded ${ASSETS.length} assets`);
}

main()
	.catch((error) => {
		console.error("[db:seed] Failed to seed assets:", error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
