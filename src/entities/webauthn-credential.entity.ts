import { Exclude } from 'class-transformer';
import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  Relation,
} from 'typeorm';
import { User } from './user.entity';

@Entity('webauthn_credentials')
export class WebAuthnCredential {
  @PrimaryColumn('text', {
    primaryKeyConstraintName: 'PK_webauthn_credentials',
  })
  credential_id: string;

  @Column('char', { length: 36 })
  user_id: string;

  @Column('bytea')
  public_key: Buffer;

  @Column('bigint', {
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  sign_count: number;

  @Exclude()
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_webauthn_credentials_user',
  })
  user: Relation<User>;
}
