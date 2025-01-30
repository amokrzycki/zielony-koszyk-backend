import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Relation,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { AddressType } from '../enums/AddressType';
import { Exclude } from 'class-transformer';
import { CustomerType } from '../types/CustomerType';

@Entity('addresses')
export class Address {
  @PrimaryGeneratedColumn()
  address_id: number;

  @Column({ nullable: true })
  first_name: string;

  @Column({ nullable: true })
  last_name: string;

  @Column({ nullable: true })
  company_name: string;

  @Column({ nullable: true })
  nip: string;

  @Column()
  phone: string;

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

  @Column({
    type: 'enum',
    enum: CustomerType,
    default: CustomerType.PERSON,
  })
  customer_type: CustomerType;

  @Exclude()
  @Column({ default: false })
  is_user_address: boolean;

  @Column({ default: true })
  default: boolean;

  @Exclude()
  @Column('char', { length: 36, nullable: true })
  user_id?: string;

  @ManyToOne(() => User, (user) => user.addresses, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;
}
