import { createHmac, timingSafeEqual } from 'node:crypto';
import { MfaMethod } from '../../../src/enums/MfaMethod';
import {
  E2Variant,
  EXPECTED_HTTP_STATUS,
  HarnessError,
  RATE_LIMIT_WINDOW_MS,
  VERIFY_RATE_LIMIT,
} from './protocol';

type JsonObject = Record<string, unknown>;

const object = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const decodeJson = (value: string): JsonObject | null => {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    return object(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export type JwtClaims = JsonObject & {
  sub: string;
  iat: number;
  exp: number;
  method?: E2Variant;
  type?: string;
  jti?: string;
  rememberMe?: boolean;
};

export type JwtExpectation = {
  kind: 'mfa' | 'access' | 'refresh';
  subject: string;
  method: E2Variant;
  rememberMe?: false;
  nowSeconds?: number;
};

export const verifyJwt = (
  token: string,
  secret: string,
  expectation: JwtExpectation,
): JwtClaims | null => {
  const parts = token.split('.');
  if (parts.length !== 3 || !secret) return null;
  const header = decodeJson(parts[0]);
  const payload = decodeJson(parts[1]) as JwtClaims | null;
  if (header?.alg !== 'HS256' || !payload) return null;
  const expectedSignature = createHmac('sha256', secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest();
  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(parts[2], 'base64url');
  } catch {
    return null;
  }
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }
  const now = expectation.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (
    payload.sub !== expectation.subject ||
    payload.method !== expectation.method ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > now + 5 ||
    payload.exp <= now
  ) {
    return null;
  }
  if (
    expectation.kind === 'mfa' &&
    (payload.type !== 'mfa' ||
      typeof payload.jti !== 'string' ||
      !payload.jti ||
      payload.rememberMe !== false ||
      payload.exp - payload.iat !== 300)
  ) {
    return null;
  }
  if (
    expectation.kind === 'access' &&
    (payload.type !== undefined || payload.exp - payload.iat !== 900)
  ) {
    return null;
  }
  if (
    expectation.kind === 'refresh' &&
    (payload.type !== 'refresh' ||
      payload.rememberMe !== false ||
      payload.exp - payload.iat !== 7 * 24 * 60 * 60)
  ) {
    return null;
  }
  return payload;
};

export type PendingLogin = {
  token: string;
  jti: string;
  issuedAtMs: number;
  tokenExpiresAtMs: number;
  webauthnOptions?: JsonObject;
};

export const validatePendingLogin = (
  statusCode: number,
  bodyText: string,
  expected: {
    variant: E2Variant;
    userId: string;
    jwtSecret: string;
    nowSeconds?: number;
  },
): PendingLogin => {
  if (statusCode === 429) throw new HarnessError('PREPARATION_RATE_LIMITED');
  if (statusCode !== EXPECTED_HTTP_STATUS) {
    throw new HarnessError('PREPARATION_HTTP_STATUS');
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new HarnessError('PREPARATION_JSON');
  }
  if (
    !object(body) ||
    body.mfa_required !== true ||
    body.method !== expected.variant ||
    typeof body.mfa_token !== 'string' ||
    !body.mfa_token ||
    'access_token' in body ||
    'user' in body
  ) {
    throw new HarnessError('PREPARATION_SEMANTIC');
  }
  const claims = verifyJwt(body.mfa_token, expected.jwtSecret, {
    kind: 'mfa',
    subject: expected.userId,
    method: expected.variant,
    rememberMe: false,
    nowSeconds: expected.nowSeconds,
  });
  if (!claims?.jti) throw new HarnessError('PREPARATION_MFA_JWT');
  const options = object(body.webauthn_options)
    ? body.webauthn_options
    : undefined;
  if (
    (expected.variant === MfaMethod.WEBAUTHN &&
      (!options || typeof options.challenge !== 'string')) ||
    (expected.variant !== MfaMethod.WEBAUTHN &&
      body.webauthn_options !== undefined)
  ) {
    throw new HarnessError('PREPARATION_VARIANT_DATA');
  }
  return {
    token: body.mfa_token,
    jti: claims.jti,
    issuedAtMs: claims.iat * 1_000,
    tokenExpiresAtMs: claims.exp * 1_000,
    webauthnOptions: options,
  };
};

type Cookie = {
  name: string;
  value: string;
  attributes: Map<string, string | true>;
};

const parseCookie = (text: string): Cookie | null => {
  const parts = text.split(';').map((part) => part.trim());
  const separator = parts[0]?.indexOf('=') ?? -1;
  if (separator < 1) return null;
  const attributes = new Map<string, string | true>();
  for (const part of parts.slice(1)) {
    const index = part.indexOf('=');
    if (index < 0) attributes.set(part.toLowerCase(), true);
    else
      attributes.set(part.slice(0, index).toLowerCase(), part.slice(index + 1));
  }
  return {
    name: parts[0].slice(0, separator),
    value: parts[0].slice(separator + 1),
    attributes,
  };
};

export type SemanticResponse = {
  statusCode: number;
  contentType: string;
  rateLimitLimit: string;
  rateLimitRemaining: string;
  rateLimitReset: string;
  bodyText: string;
  setCookie: string[];
  requestCount: number;
  redirectCount: number;
  retryCount: number;
};

export type SemanticExpectation = {
  variant: E2Variant;
  userId: string;
  jwtSecret: string;
  nodeEnv: string;
  nowSeconds?: number;
};

export type SemanticCode =
  | 'OK'
  | 'SEMANTIC_REQUEST_COUNT'
  | 'SEMANTIC_REDIRECT'
  | 'SEMANTIC_RETRY'
  | 'SEMANTIC_HTTP_STATUS'
  | 'SEMANTIC_CONTENT_TYPE'
  | 'SEMANTIC_RATE_LIMIT_HEADERS'
  | 'SEMANTIC_JSON'
  | 'SEMANTIC_BODY'
  | 'SEMANTIC_USER_MISMATCH'
  | 'SEMANTIC_PROTECTED_FIELD'
  | 'SEMANTIC_ACCESS_JWT'
  | 'SEMANTIC_COOKIE_COUNT'
  | 'SEMANTIC_COOKIE_FORMAT'
  | 'SEMANTIC_COOKIE_FLAGS'
  | 'SEMANTIC_REFRESH_JWT';

export const validateSemanticResponse = (
  response: SemanticResponse,
  expected: SemanticExpectation,
): SemanticCode => {
  if (response.requestCount !== 1) return 'SEMANTIC_REQUEST_COUNT';
  if (response.redirectCount !== 0) return 'SEMANTIC_REDIRECT';
  if (response.retryCount !== 0) return 'SEMANTIC_RETRY';
  if (response.statusCode !== EXPECTED_HTTP_STATUS) {
    return 'SEMANTIC_HTTP_STATUS';
  }
  if (!/^application\/json(?:\s*;|$)/i.test(response.contentType)) {
    return 'SEMANTIC_CONTENT_TYPE';
  }
  const rateLimitReset = Number(response.rateLimitReset);
  if (
    response.rateLimitLimit !== String(VERIFY_RATE_LIMIT) ||
    response.rateLimitRemaining !== String(VERIFY_RATE_LIMIT - 1) ||
    !Number.isSafeInteger(rateLimitReset) ||
    rateLimitReset < 1 ||
    rateLimitReset > RATE_LIMIT_WINDOW_MS / 1_000
  ) {
    return 'SEMANTIC_RATE_LIMIT_HEADERS';
  }
  let body: unknown;
  try {
    body = JSON.parse(response.bodyText);
  } catch {
    return 'SEMANTIC_JSON';
  }
  if (
    !object(body) ||
    body.mfa_required !== false ||
    typeof body.access_token !== 'string' ||
    !body.access_token ||
    !object(body.user) ||
    'mfa_token' in body ||
    'refresh_token' in body
  ) {
    return 'SEMANTIC_BODY';
  }
  const user = body.user;
  if (
    user.user_id !== expected.userId ||
    user.mfa_method !== expected.variant
  ) {
    return 'SEMANTIC_USER_MISMATCH';
  }
  if (
    ['password', 'totp_secret_encrypted', 'totp_last_used_step'].some(
      (field) => field in user,
    )
  ) {
    return 'SEMANTIC_PROTECTED_FIELD';
  }
  if (
    !verifyJwt(body.access_token, expected.jwtSecret, {
      kind: 'access',
      subject: expected.userId,
      method: expected.variant,
      nowSeconds: expected.nowSeconds,
    })
  ) {
    return 'SEMANTIC_ACCESS_JWT';
  }
  if (response.setCookie.length !== 2) return 'SEMANTIC_COOKIE_COUNT';
  const cookies = response.setCookie.map(parseCookie);
  if (cookies.some((cookie) => !cookie)) return 'SEMANTIC_COOKIE_FORMAT';
  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie]));
  if (
    byName.size !== 2 ||
    !byName.has('accessToken') ||
    !byName.has('refreshToken')
  ) {
    return 'SEMANTIC_COOKIE_COUNT';
  }
  const access = byName.get('accessToken');
  const refresh = byName.get('refreshToken');
  if (!access || !refresh || access.value !== body.access_token) {
    return 'SEMANTIC_COOKIE_FORMAT';
  }
  const secureExpected = expected.nodeEnv === 'production';
  const validFlags = (cookie: Cookie) =>
    cookie.attributes.has('httponly') &&
    String(cookie.attributes.get('samesite')).toLowerCase() === 'strict' &&
    cookie.attributes.has('secure') === secureExpected;
  if (
    !validFlags(access) ||
    !validFlags(refresh) ||
    access.attributes.get('max-age') !== '900' ||
    refresh.attributes.has('max-age') ||
    refresh.attributes.has('expires')
  ) {
    return 'SEMANTIC_COOKIE_FLAGS';
  }
  if (
    !verifyJwt(refresh.value, expected.jwtSecret, {
      kind: 'refresh',
      subject: expected.userId,
      method: expected.variant,
      rememberMe: false,
      nowSeconds: expected.nowSeconds,
    })
  ) {
    return 'SEMANTIC_REFRESH_JWT';
  }
  return 'OK';
};

export class SecretRegistry {
  private values = new Set<string>();

  add(value: unknown) {
    if (typeof value === 'string' && value) this.values.add(value);
  }

  addAssertion(value: unknown) {
    const visit = (entry: unknown) => {
      if (typeof entry === 'string') {
        if (entry.length >= 4 && entry !== 'public-key') this.values.add(entry);
      } else if (Array.isArray(entry)) {
        entry.forEach(visit);
      } else if (object(entry)) {
        Object.values(entry).forEach(visit);
      }
    };
    visit(value);
    this.add(JSON.stringify(value));
  }

  all() {
    return [...this.values];
  }

  clear() {
    this.values.clear();
  }
}

export const scanTextForSecrets = (text: string, exact: string[]) => {
  const codes = new Set<string>();
  if (exact.some((value) => value && text.includes(value))) {
    codes.add('KNOWN_SECRET');
  }
  if (
    /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![A-Za-z0-9_-])/.test(
      text,
    )
  ) {
    codes.add('JWT');
  }
  if (
    /^(?:Authorization|Cookie|Set-Cookie)\s*:/im.test(text) ||
    /["'](?:authorization|cookie|set-cookie|setCookie|requestHeaders|responseHeaders)["']\s*:/i.test(
      text,
    )
  ) {
    codes.add('SENSITIVE_HEADER');
  }
  if (/(?:accessToken|refreshToken)=[^;\s]+/i.test(text)) {
    codes.add('COOKIE_VALUE');
  }
  if (/["'](?:mfa_token|access_token|refresh_token)["']\s*[:=]/i.test(text)) {
    codes.add('SESSION_FIELD');
  }
  if (
    /["'](?:body|bodyText|request_body|response_body|requestBody|responseBody|requestData|responseData|samplerData)["']\s*[:=]/i.test(
      text,
    )
  ) {
    codes.add('BODY_FIELD');
  }
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|["'](?:password(?:_hash)?|secret|totp_secret(?:_encrypted)?|totpSecret|otp_digest|privateKey|private_key|apiKey|api_key)["']\s*[:=]/i.test(
      text,
    )
  ) {
    codes.add('PRIVATE_SECRET');
  }
  if (
    /["'](?:credential_id|credentialId|rawId|authenticatorData|clientDataJSON|signature|userHandle)["']\s*[:=]/i.test(
      text,
    )
  ) {
    codes.add('WEBAUTHN_MATERIAL');
  }
  if (/["']user_id["']\s*[:=]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/i.test(text)) {
    codes.add('ACCOUNT_IDENTITY');
  }
  return [...codes].sort();
};
