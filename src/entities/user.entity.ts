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

// TODO: Rework address to be an object with street, city, state, and zip

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
  @Column('text')
  address: string;
  @Column()
  phone: string;
  @CreateDateColumn()
  created_at: Date;

  @BeforeInsert()
  generateId() {
    this.user_id = uuidv4();
  }
}
