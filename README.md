# Zielony Koszyk — backend

Backend sklepu w NestJS 11 z PostgreSQL oraz uwierzytelnianiem hasłem i MFA
(e-mail OTP, TOTP, WebAuthn).

## Uruchomienie

Wymagany jest Node.js 26 oraz PostgreSQL dostępny przez `DATABASE_URL`.

```bash
cp .env.example .env
# Uzupełnij wszystkie wartości; dwa klucze MFA wygeneruj osobno:
openssl rand -base64 32
npm ci
npm run migration:run
npm run build
npm run start:prod
```

Aplikacja waliduje konfigurację przy starcie. Pliki `.env*` poza
`.env.example` są wykluczone z kontekstu obrazu Docker; kontenerowi należy
przekazać konfigurację w runtime przez `--env-file` lub konfigurację hosta.

Końcowy zestaw testów MFA, niewymagający połączenia z zewnętrzną bazą ani
Mailgunem:

```bash
npm run test:mfa
```

Powtarzalny profil badawczy, scenariusze i granice pomiarów opisuje
[MFA_RESEARCH_RUNBOOK.md](MFA_RESEARCH_RUNBOOK.md).
