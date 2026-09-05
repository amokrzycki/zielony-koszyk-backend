import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../services/user.service';
import { User } from '../entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UserService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<Partial<User>> {
    const user = await this.usersService.findByEmail(email);

    if (user && (await bcrypt.compare(password, user.password))) {
      const result = { ...user };
      delete result.password;
      return result;
    }
    return null;
  }

  login(user: Partial<User>, rememberMe = false) {
    const payload = { email: user.email, sub: user.user_id, role: user.role };
    const access_token = this.jwtService.sign(payload, {
      expiresIn: '15m',
      algorithm: 'HS256',
    });
    const refresh_token = this.jwtService.sign(
      { ...payload, type: 'refresh', rememberMe },
      { expiresIn: '7d', algorithm: 'HS256' },
    );
    return {
      access_token,
      refresh_token,
      user: user,
    };
  }

  async refresh(user: Partial<User> & { rememberMe?: boolean }) {
    const account = await this.usersService.findById(user.user_id);
    if (!account) throw new UnauthorizedException();

    const userData = { ...account };
    delete userData.password;
    return {
      ...this.login(userData, user.rememberMe),
      rememberMe: user.rememberMe,
    };
  }
}
