import { IsNotEmpty, IsString, IsUUID, Matches } from 'class-validator';

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
