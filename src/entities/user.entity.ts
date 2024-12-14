import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  BeforeInsert,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Roles } from '../enums/Roles';
import { Exclude } from 'class-transformer';

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
  @Column()
  street: string;
  @Column()
  building_number: string;
  @Column()
  zip: string;
  @Column()
  city: string;
  @Column()
  phone: string;
  @CreateDateColumn()
  created_at: Date;

  @BeforeInsert()
  generateId() {
    this.user_id = uuidv4();
  }
}
