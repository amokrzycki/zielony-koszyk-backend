import { Exclude } from 'class-transformer';
import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Relation,
  Unique,
} from 'typeorm';
import { ACTIVE_MFA_METHODS, ActiveMfaMethod } from '../enums/MfaMethod';
import { User } from './user.entity';

export enum MfaChallengePurpose {
  LOGIN = 'LOGIN',
  ENROLLMENT = 'ENROLLMENT',
}

@Entity('mfa_challenges')
@Unique('UQ_mfa_challenges_user_purpose', ['user_id', 'purpose'])
export class MfaChallenge {
  @PrimaryColumn('uuid', { primaryKeyConstraintName: 'PK_mfa_challenges' })
  challenge_id: string;

  @Column('char', { length: 36 })
  user_id: string;

  @Column({
    type: 'enum',
    enum: ACTIVE_MFA_METHODS,
    enumName: 'mfa_challenges_method_enum',
  })
  method: ActiveMfaMethod;

  @Column({
    type: 'enum',
    enum: MfaChallengePurpose,
    enumName: 'mfa_challenges_purpose_enum',
  })
  purpose: MfaChallengePurpose;

  @Exclude()
  @Column('char', { length: 64, nullable: true, select: false })
  otp_digest: string | null;

  @Exclude()
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  webauthn_challenge: string | null;

  @Exclude()
  @Column({ type: 'text', nullable: true, select: false })
  totp_secret_encrypted: string | null;

  @Column('smallint', { default: 0 })
  attempt_count: number;

  @Column('timestamptz')
  expires_at: Date;

  @Exclude()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_mfa_challenges_user',
  })
  user: Relation<User>;

  @BeforeInsert()
  generateId() {
    this.challenge_id ??= randomUUID();
  }
}
