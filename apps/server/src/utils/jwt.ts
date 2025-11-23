import jwt, { type JwtPayload } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
	throw new Error("JWT_SECRET is not defined");
}

export interface SignupTokenPayload extends JwtPayload {
	email: string;
}

export function generateSignupToken(email: string): string {
	return jwt.sign({ email }, JWT_SECRET!, { expiresIn: "15m" });
}

export function verifySignupToken(token: string): SignupTokenPayload | null {
	try {
		return jwt.verify(token, JWT_SECRET!) as SignupTokenPayload;
	} catch {
		return null;
	}
}

export interface AuthTokenData {
	id: string;
	email: string;
}

export function jwtsign(data: AuthTokenData): string {
	return jwt.sign(data, JWT_SECRET!, { expiresIn: "7d" });
}

export function jwtverify(token: string): AuthTokenData | null {
	try {
		return jwt.verify(token, JWT_SECRET!) as AuthTokenData;
	} catch {
		return null;
	}
}
