import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  BeforeInsert,
  OneToMany,
  Relation,
} from 'typeorm';
import { randomUUID } from 'node:crypto';
import { Roles } from '../enums/Roles';
import { Exclude } from 'class-transformer';
import { Address } from './address.entity';
import { MfaMethod } from '../enums/MfaMethod';

@Entity('users')
export class User {
  @PrimaryColumn('char', { length: 36 })
  user_id: string;

  @Column({ type: 'enum', enum: Roles, default: Roles.USER })
  role: Roles;

  @Exclude()
  @Column()
  password: string;

  @Column({ unique: true })
  email: string;

  @Column()
  first_name: string;

  @Column()
  last_name: string;

  @OneToMany(() => Address, (address) => address.user, {
    cascade: true,
    eager: true,
  })
  addresses: Relation<Address[]>;

  @Column()
  phone: string;

  @Column({
    type: 'enum',
    enum: MfaMethod,
    enumName: 'users_mfa_method_enum',
    default: MfaMethod.NONE,
  })
  mfa_method: MfaMethod;

  @Exclude()
  @Column({ type: 'text', nullable: true, select: false })
  totp_secret_encrypted: string | null;

  @Exclude()
  @Column({ type: 'integer', nullable: true, select: false })
  totp_last_used_step: number | null;

  @CreateDateColumn()
  created_at: Date;

  @CreateDateColumn()
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    this.user_id = randomUUID();
  }
}
