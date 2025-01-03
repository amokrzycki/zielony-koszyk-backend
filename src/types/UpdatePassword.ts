import { Users } from '../entities/users.entity';

export type UpdatePassword = Partial<Users> & {
  new_password: string;
};
