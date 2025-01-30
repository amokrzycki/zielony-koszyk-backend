import { User } from '../entities/user.entity';

export type UpdatePassword = Partial<User> & {
  new_password: string;
};
