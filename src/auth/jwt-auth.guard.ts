import { Injectable } from '@nestjs/common';
import { AuthGuard, IAuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') implements IAuthGuard {}

@Injectable()
export class RefreshTokenAuthGuard
  extends AuthGuard('jwt-refresh')
  implements IAuthGuard {}
