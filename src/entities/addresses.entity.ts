import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Relation,
  JoinColumn,
} from 'typeorm';
import { Users } from './users.entity';
import { AddressType } from '../enums/AddressType';

@Entity()
export class Addresses {
  @PrimaryGeneratedColumn()
  address_id: number;

  @Column()
  street: string;

  @Column()
  building_number: string;

  @Column({ nullable: true })
  flat_number: string;

  @Column()
  city: string;

  @Column()
  zip: string;

  @Column({
    type: 'enum',
    enum: AddressType,
  })
  type: AddressType;

  @Column('char', { length: 36, nullable: true })
  user_id: string;

  @ManyToOne(() => Users, (user) => user.addresses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<Users>;
}
