import { IsBoolean, IsOptional } from 'class-validator';

export class LoginDto {
  email: string;
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
