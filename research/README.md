# Dataset badawczy MFA

## Przeznaczenie i struktura

Mechanizm przygotowuje wejście do późniejszego eksperymentu wydajnościowego. Provisioning nie jest częścią benchmarku. Dataset zawiera 50 logicznych klientów (`client_slot` `001`–`050`) i po jednym koncie każdego wariantu `NONE`, `EMAIL_OTP`, `TOTP`, `WEBAUTHN`, łącznie 200 kont. Konta mają e-maile `bench-<wariant>-<slot>@<RESEARCH_MAIL_DOMAIN>` i rolę `USER`.

## Wymagane środowisko

Uzupełnij standardowe zmienne backendu opisane w `.env.example` oraz:

- `MFA_RESEARCH_PASSWORD` — wspólne hasło podane jawnie przez operatora; skrypty go nie generują ani nie zapisują;
- `RESEARCH_MAIL_DOMAIN` — syntetyczna domena e-mail;
- opcjonalnie `RESEARCH_BACKEND_URL`, `RESEARCH_FRONTEND_URL`, `RESEARCH_CHROMIUM_PATH`;
- przy restore: `MFA_RESEARCH_RESTORE_DATABASE_URL` — jawny docelowy PostgreSQL.

Uruchom PostgreSQL z wykonanymi migracjami, backend, zbudowany frontend pod originem zgodnym z `WEBAUTHN_ORIGIN` oraz Chromium. Provisioning respektuje limiter 5 żądań na 60 sekund i może trwać ponad 30 minut.

## Provisioning

```bash
npm run research:dataset:provision
```

Komenda wykonuje preflight, idempotentny seed, aktywację e-mail OTP, rzeczywisty enrollment TOTP przez HTTP, rzeczywisty enrollment WebAuthn przez UI i CDP, dry run, cleanup challenge, manifesty, walidację oraz `pg_dump`. Nie uruchamiaj jej w trakcie pomiaru.

## Walidacja

```bash
npm run research:dataset:validate
```

Exit code `0` i końcowy komunikat `DATASET VALID` są wymagane przed eksperymentem. Walidator porównuje DB, `accounts.csv`, magazyn TOTP i snapshot authenticatora; sprawdza 200 kont, rozkład 50×4, 50 powiązanych credentiali WebAuthn oraz brak challenge należących do kont research. Stan zwykłych użytkowników pozostaje poza datasetem.

## Reset

```bash
npm run research:dataset:reset -- --yes
```

Bez `--yes` lub `MFA_RESEARCH_ALLOW_RESET=1` reset niczego nie usuwa. Usuwane są wyłącznie konta dokładnie należące do bieżącej domeny research, ich stan MFA oraz wygenerowane artefakty. Zwykli użytkownicy pozostają bez zmian.

## Snapshot i restore

Po poprawnej walidacji provisioning tworzy `research/snapshots/research-db.dump`. Snapshot DB i `webauthn-authenticator.json` stanowią nierozłączną parę golden datasetu.

Ręczne odtworzenie wymaga zatrzymanego backendu, jawnego docelowego URL i potwierdzenia:

```bash
MFA_RESEARCH_RESTORE_DATABASE_URL='postgresql://...' npm run research:dataset:restore -- --yes
npm run research:webauthn:import
```

Restore wykonuje `pg_restore --clean` wyłącznie wobec wskazanego celu. Druga komenda uruchamia jeden wirtualny authenticator z 50 credentialami i działa do `Ctrl+C`. Countery DB i authenticatora muszą ewoluować razem; golden parę przywracaj tylko przed nowym kompletnym eksperymentem.

## Artefakty

Publiczne i dozwolone w commicie:

- `research/dataset/accounts.csv` — `client_slot`, wariant, UUID, e-mail;
- `research/dataset/dataset.json` — wersje środowiska i metadane bez haseł;
- skrypty, testy i ten runbook.

Lokalne, ignorowane przez Git:

- `research/secrets/totp-secrets.json` — jawne sekrety TOTP;
- `research/snapshots/webauthn-authenticator.json` — prywatne klucze authenticatora;
- `research/snapshots/research-db.dump` — DB z hashami i stanem MFA.

Nie kopiuj lokalnych artefaktów do `results`, logów ani repozytorium. Przed eksperymentem uruchom migracje, provisioning lub restore pary golden, `npm run research:dataset:validate`, testy i `git status`. Status nie może zawierać hasła, JWT, sekretu TOTP ani prywatnego klucza WebAuthn.
