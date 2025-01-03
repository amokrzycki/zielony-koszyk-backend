import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { Users } from '../entities/users.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdatePassword } from '../types/UpdatePassword';
import { UpdateAddressDto } from '../dto/update-address.dto';
import { Addresses } from '../entities/addresses.entity';
import { CreateAddressDto } from '../dto/create-address.dto';
import { ApiBearerAuth } from '@nestjs/swagger';

@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(): Promise<Users[]> {
    return this.usersService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string): Promise<Users> {
    return this.usersService.findById(id);
  }

  @Post('register')
  async register(@Body() user: CreateUserDto): Promise<Users> {
    return this.usersService.create(user);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() user: Partial<Users>,
  ): Promise<Users> {
    return this.usersService.update(id, user);
  }

  @Put('password-change/:id')
  updatePassword(
    @Param('id') id: string,
    @Body() user: UpdatePassword,
  ): Promise<Users> {
    return this.usersService.updatePassword(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/address')
  addAddress(
    @Param('id') id: string,
    @Body() addressDto: CreateAddressDto,
  ): Promise<Users> {
    return this.usersService.addAddressToUser(id, addressDto);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/address/:addressId')
  updateUserDetails(
    @Param('id') userId: string,
    @Param('addressId') addressId: string,
    @Body() updateDto: UpdateAddressDto,
  ): Promise<Users> {
    return this.usersService.updateUserDetails(userId, +addressId, updateDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/addresses')
  getUserAddresses(@Param('id') id: string): Promise<Addresses[]> {
    return this.usersService.getUserAddresses(id);
  }
}
