import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../entities/users.entity';
import { UsersService } from '../services/users.service';
import { UsersController } from '../controllers/users.controller';
import { Addresses } from '../entities/addresses.entity';
import { MailService } from '../services/mail.service';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [TypeOrmModule.forFeature([Users, Addresses])],
  providers: [UsersService, ConfigService, MailService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
