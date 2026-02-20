"use client";

import { useUser } from "@/hooks/use-auth";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import Loader from "./loader";

type AuthGuardMode = "protected" | "guest";

export default function AuthGuard({
	children,
	mode = "protected",
}: {
	children: React.ReactNode;
	mode?: AuthGuardMode;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const { data: user, isLoading } = useUser();
	const isLoginRoute = pathname === "/login";
	const isProtectedMode = mode === "protected";

	useEffect(() => {
		if (isLoading) {
			return;
		}

		if (isProtectedMode && !user && !isLoginRoute) {
			router.replace("/login" as never);
			return;
		}

		if (!isProtectedMode && user) {
			router.replace("/" as never);
		}
	}, [isLoading, isLoginRoute, isProtectedMode, router, user]);

	if (isLoading) {
		return <Loader />;
	}

	if (isProtectedMode && !user) {
		return <Loader />;
	}

	if (!isProtectedMode && user) {
		return <Loader />;
	}

	return <>{children}</>;
}
