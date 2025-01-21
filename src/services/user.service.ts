import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { User } from '../entities/user.entity';
import * as bcrypt from 'bcrypt';
import { SALT_ROUNDS } from '../constants/constants';
import { UpdatePassword } from '../types/UpdatePassword';
import { Address } from '../entities/address.entity';
import { CreateAddressDto } from '../dto/create-address.dto';
import { RegisterUserDto } from '../dto/register-user.dto';
import { AddressType } from '../enums/AddressType';
import { UpdateUserDto } from '../dto/update-user.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { MailService } from './mail.service';
import { generateRandomPassword } from '../utils/generateRandomPassword';
import { CustomerType } from '../types/CustomerType';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Address)
    private addressesRepository: Repository<Address>,
    private mailService: MailService,
  ) {}

  findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  findByEmail(email: string): Promise<User> {
    return this.usersRepository.findOneBy({ email: email });
  }

  findById(id: string): Promise<User> {
    return this.usersRepository.findOneBy({ user_id: id });
  }

  async create(user: RegisterUserDto): Promise<User> {
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

    const [billingAddress, deliveryAddress] = this.createAddresses(
      user,
      savedUser,
    );

    await this.addressesRepository.save([billingAddress, deliveryAddress]);

    return this.usersRepository.findOne({
      where: { user_id: savedUser.user_id },
      relations: ['addresses'],
    });
  }

  async createUserFromAdmin(user: CreateUserDto): Promise<User> {
    const existingUser = await this.usersRepository.findOneBy({
      email: user.email,
    });

    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const generatedPassword = generateRandomPassword(12);

    const hashedPassword = await bcrypt.hash(generatedPassword, SALT_ROUNDS);

    const newUser = this.usersRepository.create({
      ...user,
      password: hashedPassword,
    });

    const savedUser = await this.usersRepository.save(newUser);

    delete savedUser.password;

    const [billingAddress, deliveryAddress] = this.createAddresses(
      user,
      savedUser,
    );

    await this.addressesRepository.save([billingAddress, deliveryAddress]);

    try {
      await this.mailService.sendEmailWithPassword(
        savedUser,
        generatedPassword,
      );
    } catch (error) {
      console.error('Error sending email with password:', error);
    }

    return this.usersRepository.findOne({
      where: { user_id: savedUser.user_id },
      relations: ['addresses'],
    });
  }

  async update(id: string, user: UpdateUserDto): Promise<User> {
    const userToUpdate = await this.usersRepository.findOneBy({ user_id: id });

    if (!userToUpdate) {
      throw new NotFoundException('User not found');
    }

    await this.usersRepository.update(id, {
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.phone,
      updated_at: new Date(),
    });

    return this.usersRepository.findOne({
      where: { user_id: id },
      relations: ['addresses'],
    });
  }

  async updatePassword(id: string, user: UpdatePassword): Promise<User> {
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
  ): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { user_id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const address = this.addressesRepository.create({
      ...addressDto,
      user,
      is_user_address: true,
      default: false,
    });
    await this.addressesRepository.save(address);

    return this.usersRepository.findOne({
      where: { user_id: userId },
      relations: ['addresses'],
    });
  }

  async updateUserDetails(
    userId: string,
    addressId: number,
    updateDto: CreateAddressDto,
  ): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { user_id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.usersRepository.update(userId, {
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

    if (updateDto.customer_type === CustomerType.COMPANY) {
      updateDto.first_name = null;
      updateDto.last_name = null;
    }

    if (updateDto.customer_type === CustomerType.PERSON) {
      updateDto.company_name = null;
      updateDto.nip = null;
    }

    // find the address with the same type that is in the payload, if default is in payload, change default to false
    const addressWithSameType = await this.addressesRepository.findOne({
      where: {
        type: updateDto.type,
        address_id: Not(addressId),
        default: true,
      },
    });

    if (addressWithSameType) {
      addressWithSameType.default = false;
      await this.addressesRepository.save(addressWithSameType);
    }

    Object.assign(address, updateDto);
    await this.addressesRepository.save(address);

    return this.usersRepository.findOne({
      where: { user_id: userId },
      relations: ['addresses'],
    });
  }

  async getUserAddresses(userId: string): Promise<Address[]> {
    const user = await this.usersRepository.findOne({
      where: { user_id: userId },
      relations: ['addresses'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.addresses;
  }

  private createAddresses(
    user: CreateUserDto | RegisterUserDto,
    savedUser: User,
  ) {
    const billingAddress = this.addressesRepository.create({
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
      street: user.street,
      city: user.city,
      zip: user.zip,
      building_number: user.building_number,
      flat_number: user.flat_number,
      type: AddressType.BILLING,
      customer_type: CustomerType.PERSON,
      user: savedUser,
      is_user_address: true,
    });

    const deliveryAddress = this.addressesRepository.create({
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
      street: user.street,
      city: user.city,
      zip: user.zip,
      building_number: user.building_number,
      flat_number: user.flat_number,
      type: AddressType.DELIVERY,
      customer_type: CustomerType.PERSON,
      user: savedUser,
      is_user_address: true,
    });

    return [billingAddress, deliveryAddress];
  }
}
