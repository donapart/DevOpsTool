/**
 * User-facing errors - these get shown in notifications.
 * Message should be friendly and actionable.
 */
export class UserError extends Error {
    constructor(
        message: string,
        public readonly suggestion?: string
    ) {
        super(message);
        this.name = 'UserError';
    }
}

/**
 * Auth errors - token invalid, expired, or missing.
 */
export class AuthError extends UserError {
    constructor(provider: string) {
        super(
            `${provider} Token ist ungültig oder abgelaufen.`,
            `Bitte setzen Sie den Token neu (Command Palette → Set ${provider} Token).`
        );
        this.name = 'AuthError';
    }
}

/**
 * API errors - server-side issues.
 */
export class ApiError extends Error {
    constructor(
        public readonly provider: string,
        public readonly statusCode: number,
        public readonly statusText: string,
        public readonly responseBody?: string
    ) {
        super(`${provider} API Error (${statusCode}): ${statusText}`);
        this.name = 'ApiError';
    }
}

/**
 * Read-Only mode active - operation blocked.
 */
export class ReadOnlyError extends UserError {
    constructor() {
        super(
            'Read-Only Modus ist aktiv.',
            'Deaktivieren Sie den Read-Only Modus in den Einstellungen (devops.readOnly), um Änderungen vorzunehmen.'
        );
        this.name = 'ReadOnlyError';
    }
}

/**
 * Helper to check if error is auth-related (401/403).
 */
export function isAuthError(statusCode: number): boolean {
    return statusCode === 401 || statusCode === 403;
}
