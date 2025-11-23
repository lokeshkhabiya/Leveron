import type { Request, Response } from "express";
import prisma from "@exness-clone/db";
import { generateSignupToken, jwtsign, verifySignupToken } from "@/utils/jwt";
import { sendMagicLinkToUser } from "@/utils/resendmail";
import { setAuthCookie } from "@/utils/cookie";

const magicLinkBaseUrl = process.env.MAGIC_LINK_BASE_URL!;
if (!magicLinkBaseUrl) {
	throw new Error("MAGIC_LINK_BASE_URL is not defined");
}

const login = async (req: Request, res: Response) => {
	try {
		const { email } = req.body as { email: string };

		if (!email) {
			return res.status(400).json({
				success: false,
				message: "Email is not provided!",
			});
		}

		const token = generateSignupToken(email);

		const magicLink = `${magicLinkBaseUrl}/verify?token=${encodeURIComponent(token)}`;

		await sendMagicLinkToUser(email, magicLink);

		return res.status(200).json({
			success: true,
			message: "Verification Email Sent Successfully!",
		});
	} catch (error: any) {
		console.log(
			"Error while signing up the user: ",
			error.response?.data || error?.message,
		);
		return res.status(500).json({
			message: "Internal Server Error!",
		});
	}
};

const verify = async (req: Request, res: Response) => {
	try {
		const { token } = req.query;

		if (!token) {
			return res.status(400).json({
				success: false,
				message: "Verification Failed - token not found!",
			});
		}

		const decode = verifySignupToken(token as string);

		if (!decode) {
			return res.status(400).json({
				success: false,
				message: "Error while verifying token!",
			});
		}

		const email = decode.email;

		let user = await prisma.users.findUnique({
			where: { email },
		});

		if (!user) {
			user = await prisma.users.create({
				data: { email },
			});
		}

		const cookieToken = jwtsign({
			id: user?.user_id,
			email: user.email as string,
		});

		setAuthCookie(res, cookieToken);

		return res.redirect("http://localhost:3000");
	} catch (error: any) {
		console.log(
			"Error while verifying signup user: ",
			error.response?.data || error?.message,
		);
		return res.status(500).json({
			message: "Internal Server Error!",
		});
	}
};

export const authController = {
	login,
	verify,
};
