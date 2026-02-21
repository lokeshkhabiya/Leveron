"use client";

import { useLogout, useUser } from "@/hooks/use-auth";
import { useBalance } from "@/hooks/use-balance";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModeToggle } from "./mode-toggle";
import { Button } from "./ui/button";

function formatCurrency(value: number) {
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	}).format(value);
}

type HeaderProps = {
	isLiveConnected: boolean;
};

export default function Header({ isLiveConnected }: HeaderProps) {
	const router = useRouter();
	const { data: user } = useUser();
	const { data: balance } = useBalance({
		enableBackgroundPolling: !isLiveConnected,
	});
	const logout = useLogout();

	const onLogout = async () => {
		await logout.mutateAsync();
		router.replace("/login" as never);
	};

	return (
		<header className="border-b border-border bg-background/95">
			<div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between gap-3 px-4">
				<div className="flex items-center gap-4">
					<p className="font-mono text-xs uppercase tracking-[0.1em]">Leveron</p>
					<nav className="hidden items-center gap-3 text-sm text-muted-foreground md:flex">
						<Link href={"/" as never} className="hover:text-foreground transition-colors">
							Trade
						</Link>
						<Link
							href={"/login" as never}
							className="hover:text-foreground transition-colors"
						>
							Login
						</Link>
					</nav>
				</div>

				<div className="flex items-center gap-2">
					{user ? (
						<>
							<div className="hidden border border-border px-3 py-1.5 text-right md:block">
								<p className="font-mono text-xs leading-none">
									{balance ? formatCurrency(balance.total) : "--"}
								</p>
								<p className="text-[10px] text-muted-foreground">{user.email}</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								className="rounded-none"
								onClick={onLogout}
								disabled={logout.isPending}
							>
								{logout.isPending ? "..." : "Logout"}
							</Button>
						</>
					) : null}
					<ModeToggle />
				</div>
			</div>
		</header>
	);
}
