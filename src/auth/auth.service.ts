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
    const access_token = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refresh_token = this.jwtService.sign(
      { ...payload, type: 'refresh', rememberMe },
      { expiresIn: '7d' },
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

    const payload = {
      email: account.email,
      sub: account.user_id,
      role: account.role,
    };
    const access_token = this.jwtService.sign(payload, { expiresIn: '15m' });
    const refresh_token = this.jwtService.sign(
      { ...payload, type: 'refresh', rememberMe: user.rememberMe },
      { expiresIn: '7d' },
    );
    const userData = { ...account };
    delete userData.password;
    return {
      access_token,
      refresh_token,
      rememberMe: user.rememberMe,
      user: userData,
    };
  }
}
