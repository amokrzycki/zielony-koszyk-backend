import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  BeforeInsert,
  OneToMany,
  Relation,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Roles } from '../enums/Roles';
import { Exclude } from 'class-transformer';
import { Addresses } from './addresses.entity';

@Entity()
export class Users {
  @PrimaryColumn('char', { length: 36 })
  user_id: string;
  @Column({ default: Roles.USER })
  role: string;
  @Exclude()
  @Column()
  password: string;
  @Column({ unique: true })
  email: string;
  @Column()
  first_name: string;
  @Column()
  last_name: string;
  @OneToMany(() => Addresses, (address) => address.user, {
    cascade: true,
    eager: true,
  })
  addresses: Relation<Addresses[]>;
  @Column()
  phone: string;
  @CreateDateColumn()
  created_at: Date;
  @CreateDateColumn()
  updated_at: Date;

  @BeforeInsert()
  generateId() {
    this.user_id = uuidv4();
  }
}
