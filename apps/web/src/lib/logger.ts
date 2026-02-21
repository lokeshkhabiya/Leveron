type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

function emit(level: LogLevel, scope: string, message: string, context?: LogContext) {
	const payload = {
		timestamp: new Date().toISOString(),
		level,
		scope,
		message,
		...(context ? { context } : {}),
	};

	if (level === "error") {
		console.error(payload);
		return;
	}

	if (level === "warn") {
		console.warn(payload);
		return;
	}

	if (process.env.NODE_ENV !== "production" || level === "info") {
		console.log(payload);
	}
}

export function createLogger(scope: string) {
	return {
		debug(message: string, context?: LogContext) {
			emit("debug", scope, message, context);
		},
		info(message: string, context?: LogContext) {
			emit("info", scope, message, context);
		},
		warn(message: string, context?: LogContext) {
			emit("warn", scope, message, context);
		},
		error(message: string, context?: LogContext) {
			emit("error", scope, message, context);
		},
	};
}
