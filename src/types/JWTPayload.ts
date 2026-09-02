export type JWTPayload = {
  sub: string;
  email: string;
  role: string;
  type?: 'refresh';
  rememberMe?: boolean;
};
