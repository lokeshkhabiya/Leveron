type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function resolveMinLogLevel(): number {
	const value = process.env.LOG_LEVEL?.toLowerCase();
	if (
		value === "debug" ||
		value === "info" ||
		value === "warn" ||
		value === "error"
	) {
		return LOG_LEVELS[value];
	}
	return LOG_LEVELS.info;
}

function normalizeError(error: unknown) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
		};
	}
	return error;
}

const minLogLevel = resolveMinLogLevel();

function writeLog(
	level: LogLevel,
	service: string,
	message: string,
	context?: LogContext,
) {
	if (LOG_LEVELS[level] < minLogLevel) {
		return;
	}

	const payload = {
		timestamp: new Date().toISOString(),
		level,
		service,
		message,
		...(context ? { context } : {}),
	};

	if (level === "error") {
		console.error(JSON.stringify(payload));
		return;
	}

	if (level === "warn") {
		console.warn(JSON.stringify(payload));
		return;
	}

	console.log(JSON.stringify(payload));
}

export function createLogger(service: string) {
	return {
		debug(message: string, context?: LogContext) {
			writeLog("debug", service, message, context);
		},
		info(message: string, context?: LogContext) {
			writeLog("info", service, message, context);
		},
		warn(message: string, context?: LogContext) {
			writeLog("warn", service, message, context);
		},
		error(message: string, context?: LogContext) {
			writeLog("error", service, message, context);
		},
		errorWithCause(
			message: string,
			error: unknown,
			context: LogContext = {},
		) {
			writeLog("error", service, message, {
				...context,
				error: normalizeError(error),
			});
		},
	};
}
