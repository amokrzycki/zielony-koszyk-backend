# Zielony Koszyk — backend

Backend sklepu w NestJS 11 z PostgreSQL oraz uwierzytelnianiem hasłem i MFA
(e-mail OTP, TOTP, WebAuthn). Interfejs obsługuje dwa języki (PL / EN), a
dokumentację OpenAPI wystawia pod `/api`.

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

`docker-compose.yml` to starszy profil developerski wskazujący na MySQL;
aplikacja wymaga PostgreSQL, więc uruchamiaj ją przeciw bazie z `DATABASE_URL`.

## Testy

```bash
npm run test      # jednostkowe
npm run test:e2e  # e2e
npm run test:mfa  # zestaw MFA
```

`npm run test:mfa` nie wymaga połączenia z zewnętrzną bazą ani Mailgunem.

## Badania

Powtarzalny profil badawczy, scenariusze i granice pomiarów opisuje
[MFA_RESEARCH_RUNBOOK.md](MFA_RESEARCH_RUNBOOK.md). Przygotowanie datasetu
(50 klientów i 200 kont, cztery warianty MFA) oraz komendy `research:dataset:*`
opisuje [research/README.md](research/README.md).

Kampanie E1, E2 i E3 uruchamia się skryptami z prefiksem `research:e1`,
`research:e2` i `research:e3` (`preflight`, `pilot`, `full`, a dla E2 i E3
także `analysis`), a ich testy przez `npm run test:research`, `npm run test:e2`
i `npm run test:e3`.

## Wersje językowe (PL / EN)

- Język żądania pochodzi wyłącznie z nagłówka `Accept-Language` (`src/i18n/locale.ts` → `resolveLocale`, dekorator `@RequestLocale()`); `en-US` → `en`, nieobsługiwane → `pl`.
- Produkty: wspólne pola w `products`, teksty w `product_translations` (PK `product_id` + `locale`). API zwraca już zlokalizowany DTO; wyszukiwanie i sortowanie po nazwie działa na tłumaczeniu z języka żądania (z fallbackiem do `pl`). Edycja wszystkich języków: `GET /products/:id/translations`, `POST/PUT /products` z polem `translations`.
- Zamówienie zapisuje `locale` w chwili złożenia; nazwy pozycji (`order_items.product_name`) są migawką w tym języku, a rodzaj pozycji rozróżnia `order_items.item_type` (`PRODUCT` / `DELIVERY`). Faktura PDF i e-maile używają `order.locale`.
- E-maile: osobne szablony `src/constants/<nazwa>.<locale>.hbs`.
- Błędy widoczne dla użytkownika mają stabilny kod w polu `code` (`src/errors/error-code.ts`).
- Migracja: `npm run migration:run` (`1788700000000-add-localization`); istniejące teksty produktów trafiają do tłumaczeń `pl`. Angielskie teksty fixture’ów (także dla już istniejącego katalogu) uzupełnia idempotentny `npm run seed` (dopasowanie po polskiej nazwie).
- Testy migracji na prawdziwym Postgresie: `MIGRATION_TEST_DATABASE_URL=postgresql://… npx jest src/migrations` (pusta, jednorazowa baza; wszystko w transakcji z rollbackiem).
