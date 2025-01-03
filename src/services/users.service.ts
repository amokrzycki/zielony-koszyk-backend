import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Users } from '../entities/users.entity';
import * as bcrypt from 'bcrypt';
import { SALT_ROUNDS } from '../constants/constants';
import { UpdatePassword } from '../types/UpdatePassword';
import { Addresses } from '../entities/addresses.entity';
import { UpdateAddressDto } from '../dto/update-address.dto';
import { CreateAddressDto } from '../dto/create-address.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { AddressType } from '../enums/AddressType';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private usersRepository: Repository<Users>,
    @InjectRepository(Addresses)
    private addressesRepository: Repository<Addresses>,
  ) {}

  findAll(): Promise<Users[]> {
    return this.usersRepository.find();
  }

  findByEmail(email: string): Promise<Users> {
    return this.usersRepository.findOneBy({ email: email });
  }

  findById(id: string): Promise<Users> {
    return this.usersRepository.findOneBy({ user_id: id });
  }

  async create(user: CreateUserDto): Promise<Users> {
    const existingUser = await this.usersRepository.findOneBy({
      email: user.email,
    });

    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(user.password, SALT_ROUNDS);

    const newUser = this.usersRepository.create({
      ...user,
      password: hashedPassword,
    });

    const savedUser = await this.usersRepository.save(newUser);

    delete savedUser.password;

    const billingAddress = this.addressesRepository.create({
      street: user.street,
      city: user.city,
      zip: user.zip,
      building_number: user.building_number,
      flat_number: user.flat_number,
      type: AddressType.BILLING,
      user: savedUser,
    });

    const deliveryAddress = this.addressesRepository.create({
      street: user.street,
      city: user.city,
      zip: user.zip,
      building_number: user.building_number,
      flat_number: user.flat_number,
      type: AddressType.DELIVERY,
      user: savedUser,
    });

    await this.addressesRepository.save([billingAddress, deliveryAddress]);

    return this.usersRepository.findOne({
      where: { user_id: savedUser.user_id },
      relations: ['addresses'],
    });
  }

  async update(id: string, user: Partial<Users>): Promise<Users> {
    await this.usersRepository.update(id, user);
    return this.usersRepository.findOneBy({
      user_id: id,
      updated_at: new Date(),
    });
  }

  async updatePassword(id: string, user: UpdatePassword): Promise<Users> {
    const userToUpdate = await this.usersRepository.findOneBy({ user_id: id });

    if (!userToUpdate) {
      throw new NotFoundException('User not found');
    }

    if (!user.password || user.password.trim() === '') {
      throw new BadRequestException('Password cannot be empty');
    }

    const isPasswordCorrect = await bcrypt.compare(
      user.password,
      userToUpdate.password,
    );

    if (!isPasswordCorrect) {
      throw new BadRequestException('Old password is incorrect');
    }

    if (!user.new_password || user.new_password.trim() === '') {
      throw new BadRequestException('New password cannot be empty');
    }

    const hashedPassword = await bcrypt.hash(user.new_password, SALT_ROUNDS);

    await this.usersRepository.update(id, {
      password: hashedPassword,
      updated_at: new Date(),
    });
    return this.usersRepository.findOneBy({ user_id: id });
  }

  async remove(id: string): Promise<void> {
    await this.usersRepository.delete(id);
  }

  async addAddressToUser(
    userId: string,
    addressDto: CreateAddressDto,
  ): Promise<Users> {
    const user = await this.usersRepository.findOne({
      where: { user_id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const address = this.addressesRepository.create({ ...addressDto, user });
    await this.addressesRepository.save(address);

    return this.usersRepository.findOne({
      where: { user_id: userId },
      relations: ['addresses'],
    });
  }

  async updateUserDetails(
    userId: string,
    addressId: number,
    updateDto: UpdateAddressDto,
  ): Promise<Users> {
    const user = await this.usersRepository.findOne({
      where: { user_id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.usersRepository.update(userId, {
      phone: updateDto.phone,
      updated_at: new Date(),
    });

    const address = await this.addressesRepository.findOne({
      where: { address_id: addressId },
      relations: ['user'],
    });

    if (!address || address.user.user_id !== userId) {
      throw new NotFoundException(
        'Address not found or does not belong to this user',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { phone, ...filteredDto } = updateDto;

    Object.assign(address, filteredDto);
    await this.addressesRepository.save(address);

    return this.usersRepository.findOne({
      where: { user_id: userId },
      relations: ['addresses'],
    });
  }

  async getUserAddresses(userId: string): Promise<Addresses[]> {
    const user = await this.usersRepository.findOne({
      where: { user_id: userId },
      relations: ['addresses'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.addresses;
  }
}
