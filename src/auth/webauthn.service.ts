import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type WebAuthnCredential as SimpleWebAuthnCredential,
} from '@simplewebauthn/server';
import { WebAuthnCredential } from '../entities/webauthn-credential.entity';

const requireEnv = (configService: ConfigService, key: string) => {
  const value = configService.get<string>(key);
  if (!value) {
    throw new Error(`${key} must be configured`);
  }
  return value;
};

@Injectable()
export class WebAuthnService {
  private readonly rpID: string;
  private readonly rpName: string;
  private readonly origin: string;

  constructor(configService: ConfigService) {
    this.rpID = requireEnv(configService, 'WEBAUTHN_RP_ID');
    this.rpName =
      configService.get<string>('WEBAUTHN_RP_NAME') ?? 'Zielony Koszyk';
    this.origin = requireEnv(configService, 'WEBAUTHN_ORIGIN');
  }

  generateRegistrationOptions(
    user: { user_id: string; email: string },
    existingCredential?: Pick<WebAuthnCredential, 'credential_id'>,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: new Uint8Array(Buffer.from(user.user_id)),
      userName: user.email,
      userDisplayName: user.email,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      excludeCredentials: existingCredential
        ? [{ id: existingCredential.credential_id }]
        : [],
    });
  }

  verifyRegistration(
    response: RegistrationResponseJSON,
    expectedChallenge: string,
  ): Promise<VerifiedRegistrationResponse> {
    return verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      requireUserVerification: true,
    });
  }

  generateAuthenticationOptions(
    credential: Pick<WebAuthnCredential, 'credential_id'>,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: [{ id: credential.credential_id }],
      userVerification: 'required',
    });
  }

  verifyAuthentication(
    response: AuthenticationResponseJSON,
    expectedChallenge: string,
    credential: SimpleWebAuthnCredential,
  ): Promise<VerifiedAuthenticationResponse> {
    return verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      credential,
      requireUserVerification: true,
    });
  }
}
