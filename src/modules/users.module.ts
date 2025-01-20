import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { UsersService } from '../services/users.service';
import { UsersController } from '../controllers/users.controller';
import { Address } from '../entities/address.entity';
import { MailService } from '../services/mail.service';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [TypeOrmModule.forFeature([User, Address])],
  providers: [UsersService, ConfigService, MailService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
