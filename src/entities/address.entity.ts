import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { User } from './user.entity';
import { AddressType } from '../enums/AddressType';

@Entity()
export class Address {
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

  @ManyToOne(() => User, (user) => user.addresses, { onDelete: 'CASCADE' })
  user: User;
}
