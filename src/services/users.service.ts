import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import * as bcrypt from 'bcrypt';
import { SALT_ROUNDS } from '../constants/constants';
import { UpdatePassword } from '../types/UpdatePassword';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
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

  async create(user: Partial<User>): Promise<User> {
    const hashedPassword = await bcrypt.hash(user.password, SALT_ROUNDS);

    const newUser = this.usersRepository.create({
      ...user,
      password: hashedPassword,
    });

    const savedUser = await this.usersRepository.save(newUser);

    delete savedUser.password;

    return savedUser;
  }

  async update(id: string, user: Partial<User>): Promise<User> {
    await this.usersRepository.update(id, user);
    return this.usersRepository.findOneBy({
      user_id: id,
      updated_at: new Date(),
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
}
