import {
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

export class MfaCodeDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}

export class EmailOtpDto extends MfaCodeDto {}

export class TotpCodeDto extends MfaCodeDto {}

export class TotpEnrollmentDto {
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class TotpEnrollmentVerifyDto extends TotpCodeDto {
  @IsUUID()
  challenge_id: string;
}

export class WebAuthnRegistrationDto {
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class WebAuthnRegistrationVerifyDto {
  @IsUUID()
  challenge_id: string;

  @IsObject()
  response: RegistrationResponseJSON;
}

export class WebAuthnAuthenticationVerifyDto {
  @IsObject()
  response: AuthenticationResponseJSON;
}
