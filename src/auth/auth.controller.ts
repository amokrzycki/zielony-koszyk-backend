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
import { JwtAuthGuard } from './jwt-auth.guard';
import { GetUser } from '../decorators/get-user.decorator';

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
    } = this.authService.login(user);

    res.cookie('refreshToken', refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      access_token,
      user: userData,
    });
  }

  @Post('auth/refresh')
  @UseGuards(JwtAuthGuard)
  async refresh(
    @GetUser() user: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const { access_token, refresh_token } = this.authService.refresh(
      user as any,
    );

    res.cookie('refreshToken', refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ access_token });
  }

  @Post('auth/logout')
  async logout(@Res() res: Response) {
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out successfully' });
  }
}
