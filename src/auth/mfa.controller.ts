import { Body, Controller, Post, Put, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { GetUser } from '../decorators/get-user.decorator';
import {
  EmailOtpDto,
  TotpCodeDto,
  TotpEnrollmentDto,
  TotpEnrollmentVerifyDto,
  UpdateMfaMethodDto,
  WebAuthnAuthenticationVerifyDto,
  WebAuthnRegistrationDto,
  WebAuthnRegistrationVerifyDto,
} from '../dto/mfa.dto';
import { MfaMethod } from '../enums/MfaMethod';
import type { ActiveMfaMethod } from '../enums/MfaMethod';
import { AuthService } from './auth.service';
import { sendSession } from './auth.controller';
import { JwtAuthGuard, MfaJwtAuthGuard } from './jwt-auth.guard';
import { MfaService } from './mfa.service';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

type PendingMfaUser = {
  user_id: string;
  challenge_id: string;
  rememberMe: boolean;
  method: ActiveMfaMethod;
};

type AuthenticatedUser = Pick<PendingMfaUser, 'user_id'> & {
  method?: ActiveMfaMethod;
};

@Controller('auth/mfa')
@ApiBearerAuth()
@UseGuards(ThrottlerGuard, MfaJwtAuthGuard)
export class MfaController {
  constructor(
    private mfaService: MfaService,
    private authService: AuthService,
  ) {}

  @Post('email-otp/verify')
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
      user.method,
    );
    sendSession(res, session, user.rememberMe);
  }

  @Post('totp/verify')
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
      user.method,
    );
    sendSession(res, session, user.rememberMe);
  }

  @Post('webauthn/verify')
  async verifyWebAuthn(
    @GetUser() user: PendingMfaUser,
    @Body() body: WebAuthnAuthenticationVerifyDto,
    @Res() res: Response,
  ) {
    await this.mfaService.verifyWebAuthnAuthentication(
      user.user_id,
      user.challenge_id,
      body.response,
    );
    const session = await this.authService.completeMfa(
      user.user_id,
      user.rememberMe,
      user.method,
    );
    sendSession(res, session, user.rememberMe);
  }
}

@Controller('users/me/mfa')
@ApiBearerAuth()
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@UseGuards(ThrottlerGuard, JwtAuthGuard)
export class MfaSettingsController {
  constructor(private mfaService: MfaService) {}

  @Put()
  updateMethod(
    @GetUser() user: AuthenticatedUser,
    @Body() body: UpdateMfaMethodDto,
  ) {
    return this.mfaService.updateMethod(
      user.user_id,
      body.password,
      body.method,
      user.method,
    );
  }
}

@Controller('users/me/mfa/totp')
@ApiBearerAuth()
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@UseGuards(ThrottlerGuard, JwtAuthGuard)
export class TotpEnrollmentController {
  constructor(private mfaService: MfaService) {}

  @Post('enrollment')
  startEnrollment(
    @GetUser() user: AuthenticatedUser,
    @Body() body: TotpEnrollmentDto,
  ) {
    return this.mfaService.startTotpEnrollment(
      user.user_id,
      body.password,
      user.method,
    );
  }

  @Post('enrollment/verify')
  async verifyEnrollment(
    @GetUser() user: AuthenticatedUser,
    @Body() body: TotpEnrollmentVerifyDto,
  ) {
    await this.mfaService.verifyTotpEnrollment(
      user.user_id,
      body.challenge_id,
      body.code,
      user.method,
    );
    return { mfa_method: MfaMethod.TOTP };
  }
}

@Controller('users/me/mfa/webauthn')
@ApiBearerAuth()
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@UseGuards(ThrottlerGuard, JwtAuthGuard)
export class WebAuthnEnrollmentController {
  constructor(private mfaService: MfaService) {}

  @Post('registration')
  startRegistration(
    @GetUser() user: AuthenticatedUser,
    @Body() body: WebAuthnRegistrationDto,
  ) {
    return this.mfaService.startWebAuthnRegistration(
      user.user_id,
      body.password,
      user.method,
    );
  }

  @Post('registration/verify')
  async verifyRegistration(
    @GetUser() user: AuthenticatedUser,
    @Body() body: WebAuthnRegistrationVerifyDto,
  ) {
    await this.mfaService.verifyWebAuthnRegistration(
      user.user_id,
      body.challenge_id,
      body.response,
      user.method,
    );
    return { mfa_method: MfaMethod.WEBAUTHN };
  }
}
