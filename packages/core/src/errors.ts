export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class AuthError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'AuthError';
    if (hint !== undefined) this.hint = hint;
  }
}

export class UnofficialDisabledError extends Error {
  constructor() {
    super(
      'The unofficial transport is disabled. It uses your logged-in browser session against X web endpoints, ' +
        'which X prohibits and may result in permanent suspension. Enable it deliberately with:\n' +
        '  x config set-unofficial on --i-understand\n' +
        'and import cookies with `x auth import-cookies --file cookies.json`.',
    );
    this.name = 'UnofficialDisabledError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
