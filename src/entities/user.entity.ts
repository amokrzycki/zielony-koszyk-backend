import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  BeforeInsert,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity()
export class User {
  @PrimaryColumn('char', { length: 36 })
  user_id: string;
  @Column()
  role: string;
  @Column({ unique: true })
  username: string;
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
