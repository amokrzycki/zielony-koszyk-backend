import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Users } from '../entities/users.entity';
import { UsersService } from '../services/users.service';
import { UsersController } from '../controllers/users.controller';
import { Addresses } from '../entities/addresses.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Users, Addresses])],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
