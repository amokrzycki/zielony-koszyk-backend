import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenAuthGuard } from './jwt-auth.guard';
import { GetUser } from '../decorators/get-user.decorator';
import {
  accessCookieOptions,
  clearCookieOptions,
  refreshCookieOptions,
} from './refresh-cookie-options';
import { MfaService } from './mfa.service';
import { MfaMethod } from '../enums/MfaMethod';
import { User } from '../entities/user.entity';

type Session = ReturnType<AuthService['login']>;

@Controller()
export class AuthController {
  constructor(
    private authService: AuthService,
    private mfaService: MfaService,
  ) {}

  @Post('auth/login')
  async login(@Body() loginDto: LoginDto, @Res() res: Response) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.mfa_method !== MfaMethod.NONE) {
      const pending = await this.mfaService.createLoginChallenge(
        user as Pick<User, 'user_id' | 'mfa_method'>,
        loginDto.rememberMe,
      );
      this.clearSessionCookies(res);
      res.json({ mfa_required: true, ...pending });
      return;
    }

    this.sendSession(
      res,
      this.authService.login(user, loginDto.rememberMe),
      loginDto.rememberMe,
    );
  }

  @Post('auth/refresh')
  @UseGuards(RefreshTokenAuthGuard)
  async refresh(
    @GetUser() user: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const session = await this.authService.refresh(user);
    this.sendSession(res, session, session.rememberMe);
  }

  @Post('auth/logout')
  logout(@Res() res: Response) {
    this.clearSessionCookies(res);
    res.json({ message: 'Logged out successfully' });
  }

  private sendSession(res: Response, session: Session, rememberMe = false) {
    res.cookie(
      'refreshToken',
      session.refresh_token,
      refreshCookieOptions(rememberMe),
    );
    res.cookie('accessToken', session.access_token, accessCookieOptions());
    res.json({
      mfa_required: false,
      access_token: session.access_token,
      user: session.user,
    });
  }

  private clearSessionCookies(res: Response) {
    res.clearCookie('refreshToken', clearCookieOptions());
    res.clearCookie('accessToken', clearCookieOptions());
  }
}
