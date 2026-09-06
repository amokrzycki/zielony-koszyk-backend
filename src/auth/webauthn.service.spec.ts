import { ConfigService } from '@nestjs/config';
import type * as SimpleWebAuthnServerType from '@simplewebauthn/server';
import { WebAuthnService } from './webauthn.service';

const generateRegistrationOptions: jest.MockedFunction<
  typeof SimpleWebAuthnServerType.generateRegistrationOptions
> = jest.fn();
const verifyRegistrationResponse: jest.MockedFunction<
  typeof SimpleWebAuthnServerType.verifyRegistrationResponse
> = jest.fn();
const generateAuthenticationOptions: jest.MockedFunction<
  typeof SimpleWebAuthnServerType.generateAuthenticationOptions
> = jest.fn();
const verifyAuthenticationResponse: jest.MockedFunction<
  typeof SimpleWebAuthnServerType.verifyAuthenticationResponse
> = jest.fn();

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (
    ...args: Parameters<
      typeof SimpleWebAuthnServerType.generateRegistrationOptions
    >
  ) => generateRegistrationOptions(...args),
  verifyRegistrationResponse: (
    ...args: Parameters<
      typeof SimpleWebAuthnServerType.verifyRegistrationResponse
    >
  ) => verifyRegistrationResponse(...args),
  generateAuthenticationOptions: (
    ...args: Parameters<
      typeof SimpleWebAuthnServerType.generateAuthenticationOptions
    >
  ) => generateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (
    ...args: Parameters<
      typeof SimpleWebAuthnServerType.verifyAuthenticationResponse
    >
  ) => verifyAuthenticationResponse(...args),
}));

const config = (overrides: Record<string, string> = {}) =>
  new ConfigService({
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_ORIGIN: 'http://localhost:5173',
    ...overrides,
  });

describe('WebAuthnService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('refuses to start without RP ID or origin configured', () => {
    expect(() => new WebAuthnService(config({ WEBAUTHN_RP_ID: '' }))).toThrow(
      'WEBAUTHN_RP_ID must be configured',
    );
    expect(() => new WebAuthnService(config({ WEBAUTHN_ORIGIN: '' }))).toThrow(
      'WEBAUTHN_ORIGIN must be configured',
    );
  });

  it('defaults RP name to Zielony Koszyk', async () => {
    generateRegistrationOptions.mockResolvedValue({
      challenge: 'c',
    } as unknown as SimpleWebAuthnServerType.PublicKeyCredentialCreationOptionsJSON);
    const service = new WebAuthnService(config());

    await service.generateRegistrationOptions({
      user_id: 'user-1',
      email: 'user@example.com',
    });

    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ rpName: 'Zielony Koszyk', rpID: 'localhost' }),
    );
  });

  it('requests a platform-only, user-verified, discouraged-resident-key registration and excludes the existing credential', async () => {
    generateRegistrationOptions.mockResolvedValue({
      challenge: 'c',
    } as unknown as SimpleWebAuthnServerType.PublicKeyCredentialCreationOptionsJSON);
    const service = new WebAuthnService(
      config({ WEBAUTHN_RP_NAME: 'Custom Name' }),
    );

    await service.generateRegistrationOptions(
      { user_id: 'user-1', email: 'user@example.com' },
      { credential_id: 'existing-credential' },
    );

    expect(generateRegistrationOptions).toHaveBeenCalledWith({
      rpName: 'Custom Name',
      rpID: 'localhost',
      userID: new Uint8Array(Buffer.from('user-1')),
      userName: 'user@example.com',
      userDisplayName: 'user@example.com',
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      excludeCredentials: [{ id: 'existing-credential' }],
    });
  });

  it('verifies registration against the configured origin and RP ID with user verification required', async () => {
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
    } as unknown as SimpleWebAuthnServerType.VerifiedRegistrationResponse);
    const service = new WebAuthnService(config());

    await service.verifyRegistration(
      { id: 'response-id' } as never,
      'expected-challenge',
    );

    expect(verifyRegistrationResponse).toHaveBeenCalledWith({
      response: { id: 'response-id' },
      expectedChallenge: 'expected-challenge',
      expectedOrigin: 'http://localhost:5173',
      expectedRPID: 'localhost',
      requireUserVerification: true,
    });
  });

  it('scopes authentication options to the stored credential and requires user verification', async () => {
    generateAuthenticationOptions.mockResolvedValue({
      challenge: 'c',
    });
    const service = new WebAuthnService(config());

    await service.generateAuthenticationOptions({
      credential_id: 'stored-credential',
    });

    expect(generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: 'localhost',
      allowCredentials: [{ id: 'stored-credential' }],
      userVerification: 'required',
    });
  });

  it('verifies authentication against the configured origin, RP ID and supplied credential', async () => {
    verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
    } as unknown as SimpleWebAuthnServerType.VerifiedAuthenticationResponse);
    const service = new WebAuthnService(config());
    const credential = {
      id: 'stored-credential',
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 4,
    };

    await service.verifyAuthentication(
      { id: 'response-id' } as never,
      'expected-challenge',
      credential,
    );

    expect(verifyAuthenticationResponse).toHaveBeenCalledWith({
      response: { id: 'response-id' },
      expectedChallenge: 'expected-challenge',
      expectedOrigin: 'http://localhost:5173',
      expectedRPID: 'localhost',
      credential,
      requireUserVerification: true,
    });
  });
});
