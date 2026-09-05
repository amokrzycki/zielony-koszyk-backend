import { IsString, Matches } from 'class-validator';

export class EmailOtpDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
