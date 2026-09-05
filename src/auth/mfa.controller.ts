import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { GetUser } from '../decorators/get-user.decorator';
import { EmailOtpDto } from '../dto/mfa.dto';
import { AuthService } from './auth.service';
import { sendSession } from './auth.controller';
import { MfaJwtAuthGuard } from './jwt-auth.guard';
import { MfaService } from './mfa.service';

type PendingMfaUser = {
  user_id: string;
  challenge_id: string;
  rememberMe: boolean;
};

@Controller('auth/mfa')
export class MfaController {
  constructor(
    private mfaService: MfaService,
    private authService: AuthService,
  ) {}

  @Post('email-otp/verify')
  @UseGuards(MfaJwtAuthGuard)
  async verifyEmailOtp(
    @GetUser() user: PendingMfaUser,
    @Body() body: EmailOtpDto,
    @Res() res: Response,
  ) {
    await this.mfaService.verifyEmailOtp(
      user.user_id,
      user.challenge_id,
      body.code,
    );
    const session = await this.authService.completeMfa(
      user.user_id,
      user.rememberMe,
    );
    sendSession(res, session, user.rememberMe);
  }
}
