import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { GetUser } from '../decorators/get-user.decorator';
import {
  EmailOtpDto,
  TotpCodeDto,
  TotpEnrollmentDto,
  TotpEnrollmentVerifyDto,
} from '../dto/mfa.dto';
import { MfaMethod } from '../enums/MfaMethod';
import { AuthService } from './auth.service';
import { sendSession } from './auth.controller';
import { JwtAuthGuard, MfaJwtAuthGuard } from './jwt-auth.guard';
import { MfaService } from './mfa.service';

type PendingMfaUser = {
  user_id: string;
  challenge_id: string;
  rememberMe: boolean;
};

@Controller('auth/mfa')
@ApiBearerAuth()
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

  @Post('totp/verify')
  @UseGuards(MfaJwtAuthGuard)
  async verifyTotp(
    @GetUser() user: PendingMfaUser,
    @Body() body: TotpCodeDto,
    @Res() res: Response,
  ) {
    await this.mfaService.verifyTotp(
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

@Controller('users/me/mfa/totp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class TotpEnrollmentController {
  constructor(private mfaService: MfaService) {}

  @Post('enrollment')
  startEnrollment(
    @GetUser() user: Pick<PendingMfaUser, 'user_id'>,
    @Body() body: TotpEnrollmentDto,
  ) {
    return this.mfaService.startTotpEnrollment(user.user_id, body.password);
  }

  @Post('enrollment/verify')
  async verifyEnrollment(
    @GetUser() user: Pick<PendingMfaUser, 'user_id'>,
    @Body() body: TotpEnrollmentVerifyDto,
  ) {
    await this.mfaService.verifyTotpEnrollment(
      user.user_id,
      body.challenge_id,
      body.code,
    );
    return { mfa_method: MfaMethod.TOTP };
  }
}
