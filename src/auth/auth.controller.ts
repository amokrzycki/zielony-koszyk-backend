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
  refreshCookieOptions,
} from './refresh-cookie-options';

@Controller()
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('auth/login')
  async login(@Body() loginDto: LoginDto, @Res() res: Response) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const {
      access_token,
      refresh_token,
      user: userData,
    } = this.authService.login(user, loginDto.rememberMe);

    res.cookie(
      'refreshToken',
      refresh_token,
      refreshCookieOptions(loginDto.rememberMe),
    );
    res.cookie('accessToken', access_token, accessCookieOptions());

    res.json({
      access_token,
      user: userData,
    });
  }

  @Post('auth/refresh')
  @UseGuards(RefreshTokenAuthGuard)
  async refresh(
    @GetUser() user: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const {
      access_token,
      refresh_token,
      rememberMe,
      user: userData,
    } = await this.authService.refresh(user);

    res.cookie('refreshToken', refresh_token, refreshCookieOptions(rememberMe));
    res.cookie('accessToken', access_token, accessCookieOptions());

    res.json({ access_token, user: userData });
  }

  @Post('auth/logout')
  logout(@Res() res: Response) {
    res.clearCookie('refreshToken');
    res.clearCookie('accessToken');
    res.json({ message: 'Logged out successfully' });
  }
}
