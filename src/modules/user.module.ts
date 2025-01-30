import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { UserService } from '../services/user.service';
import { UserController } from '../controllers/user.controller';
import { Address } from '../entities/address.entity';
import { MailService } from '../services/mail.service';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [TypeOrmModule.forFeature([User, Address])],
  providers: [UserService, ConfigService, MailService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
