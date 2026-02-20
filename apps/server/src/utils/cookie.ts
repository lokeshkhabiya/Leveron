import type { Response } from "express";

export function setAuthCookie(res: Response, token: string) {
	res.cookie("leveron_token", token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
		path: "/",
	});
}

export function clearAuthCookie(res: Response) {
	res.clearCookie("leveron_token", {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "strict",
		path: "/",
	});
}
