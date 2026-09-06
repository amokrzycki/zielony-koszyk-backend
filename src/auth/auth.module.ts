import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModule } from '../modules/user.module';
import { AuthService } from './auth.service';
import {
  JwtStrategy,
  MfaJwtStrategy,
  RefreshTokenStrategy,
} from './jwt.strategy';
import { AuthController } from './auth.controller';
import { ProductModule } from '../modules/product.module';
import { OrderModule } from '../modules/order.module';
import { OrderItemModule } from '../modules/order-item.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MfaChallenge } from '../entities/mfa-challenge.entity';
import { WebAuthnCredential } from '../entities/webauthn-credential.entity';
import { MfaService } from './mfa.service';
import { WebAuthnService } from './webauthn.service';
import {
  MfaController,
  MfaSettingsController,
  TotpEnrollmentController,
  WebAuthnEnrollmentController,
} from './mfa.controller';
import { MailModule } from '../modules/mail.module';
import { User } from '../entities/user.entity';

@Module({
  imports: [
    UserModule,
    ProductModule,
    OrderModule,
    OrderItemModule,
    MailModule,
    TypeOrmModule.forFeature([MfaChallenge, WebAuthnCredential, User]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m', algorithm: 'HS256' },
      }),
    }),
  ],
  providers: [
    ConfigService,
    AuthService,
    MfaService,
    WebAuthnService,
    JwtStrategy,
    RefreshTokenStrategy,
    MfaJwtStrategy,
  ],
  controllers: [
    AuthController,
    MfaController,
    MfaSettingsController,
    TotpEnrollmentController,
    WebAuthnEnrollmentController,
  ],
  exports: [AuthService, MfaService],
})
export class AuthModule {}
