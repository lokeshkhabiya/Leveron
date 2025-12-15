import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken";

export interface extendedRequest extends Request {
	user: {
        id: string;
        email: string;
    };
}

const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies["leveron_token"];
    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    if (!decoded) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }

	(req as extendedRequest).user = decoded as {
		id: string;
		email: string;
		username: string;
	};
    next();
};

export default authMiddleware;