"use client";

import AuthGuard from "@/components/auth-guard";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLogin } from "@/hooks/use-auth";
import { useState } from "react";

export default function LoginPage() {
	const loginMutation = useLogin();
	const [email, setEmail] = useState("");
	const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

	const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		await loginMutation.mutateAsync(email);
		setSubmittedEmail(email);
	};

	return (
		<AuthGuard mode="guest">
			<main className="flex h-full items-center justify-center px-4">
				<Card className="w-full max-w-md border-border/80 shadow-none">
					<CardHeader>
						<CardTitle>Sign In</CardTitle>
						<CardDescription>
							Enter your email to receive a magic link.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form className="space-y-4" onSubmit={onSubmit}>
							<Input
								type="email"
								required
								placeholder="you@example.com"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
							/>
							<Button
								type="submit"
								className="w-full"
								disabled={loginMutation.isPending}
							>
								{loginMutation.isPending ? "Sending..." : "Send Magic Link"}
							</Button>
						</form>

						{submittedEmail ? (
							<p className="text-muted-foreground mt-4 text-sm">
								Check your email at {submittedEmail} for the login link.
							</p>
						) : null}

						{loginMutation.error ? (
							<p className="mt-3 text-sm text-red-600 dark:text-red-400">
								{loginMutation.error.message}
							</p>
						) : null}
					</CardContent>
				</Card>
			</main>
		</AuthGuard>
	);
}
