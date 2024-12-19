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
import { Address } from './address.entity';

@Entity()
export class User {
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
  @OneToMany(() => Address, (address) => address.user, {
    cascade: true,
    eager: true,
  })
  addresses: Relation<Address[]>;
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
