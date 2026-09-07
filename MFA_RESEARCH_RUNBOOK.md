# Środowisko i scenariusz badań MFA

## Wybrany profil

Badania są wykonywane na jednej instancji backendu uruchomionej bezpośrednio
na Node.js 26, z frontendem zbudowanym przez Vite, PostgreSQL udostępnionym
przez `DATABASE_URL` (obecnie Supabase) oraz rzeczywistym lokalnym Mailpit SMTP.
E1 uruchamia własny przypięty, efemeryczny Mailpit; ogólny `docker-compose.yml`
pozostaje profilem developerskim, a nie wykonawcą kampanii.

Stałe adresy profilu lokalnego:

| Element | Wartość |
| --- | --- |
| Frontend / WebAuthn origin | `http://localhost:5173` |
| Backend | `http://localhost:3000` |
| WebAuthn RP ID | `localhost` |
| WebAuthn RP name | `Zielony Koszyk` |
| SMTP | lokalny Mailpit, port `1025`, bez TLS i auth |
| Limiter | pamięciowy, jedna instancja; bez Redis i bez `trust proxy` |

## Przygotowanie

1. W backendzie skopiuj `.env.example` do `.env`, ustaw `NODE_ENV=development`
   i uzupełnij PostgreSQL, JWT, dwa różne klucze MFA, SMTP oraz `WEBAUTHN_*`.
   Klucze MFA wygeneruj dwoma osobnymi wywołaniami `openssl rand -base64 32`.
2. Ustaw frontendowe `VITE_API_URL=http://localhost:3000/`.
3. Zainstaluj dokładne wersje z lockfile i uruchom migracje:

   ```bash
   cd zielony-koszyk-backend
   npm ci
   npm run migration:run
   npm run build
   npm run test:mfa
   npm run start:prod
   ```

4. W drugim terminalu uruchom zbudowany frontend:

   ```bash
   cd zielony-koszyk
   npm ci
   npm run build
   npm run preview -- --host localhost --port 5173
   ```

Uruchomienie powinno przerwać się przy braku wymaganej zmiennej, złym URL,
niepoprawnym porcie, zbyt krótkim kluczu HMAC, złym kluczu AES albo ponownym
użyciu tego samego sekretu. `.env` jest ładowany wyłącznie w runtime i nie jest
kopiowany do obrazu.

## Rekord wykonania

Przed każdym dry runem i pomiarem zapisz poniższe wartości. Wnioski WebAuthn
dotyczą wyłącznie uwierzytelniacza platformowego; próba bez kompletnego rekordu
nie należy do zbioru wyników.

| Pole | Wartość do zapisania |
| --- | --- |
| Data i strefa czasowa | ISO 8601, np. `2026-09-06T15:00:00+02:00` |
| Rewizja backendu / frontendu | `git rev-parse HEAD` w obu repozytoriach |
| System i wersja | np. Windows 11 + numer kompilacji |
| Przeglądarka i wersja | wynik strony `chrome://version` |
| Uwierzytelniacz platformowy | np. Windows Hello i użyta biometria/PIN |
| PostgreSQL | dostawca, region i wersja serwera |
| Sieć | lokalizacja klienta i sposób połączenia |

Referencyjna walidacja przed PR 6 (2026-09-06) objęła Chrome, Windows Hello
oraz osobno passkey Bitwarden. Każda właściwa seria musi zapisać swoje wersje i
nie może uogólniać wyniku na klucze cross-platform ani logowanie passwordless.

Automatyczny dry run PR 6 wykonano 2026-09-06 na Linux
`7.2.2-1-cachyos x86_64`, Node.js `26.5.1` i npm `11.17.0`, względem bazowych
rewizji backendu `9fb2984` i frontendu `41e060d`: `npm run test:mfa` zakończył
się wynikiem 40/40, a testy UI wynikiem 6/6.

## Dry run

Dla każdej metody zacznij od pełnego logowania hasłem i nowego challenge. Nie
odtwarzaj zapisanych assertion, kodów ani tokenów pending.

1. `NONE`: potwierdź regresję pełnej sesji po haśle.
2. `EMAIL_OTP`: aktywuj metodę, wyloguj się, wykonaj
   `hasło → pending → kod z interfejsu Mailpit → pełna sesja`.
3. `TOTP`: przejdź enrollment, wyloguj się, wykonaj
   `hasło → pending → świeży kod TOTP → pełna sesja`; ponowne użycie tego kroku
   ma zostać odrzucone.
4. `WEBAUTHN`: zarejestruj uwierzytelniacz platformowy, wyloguj się, wykonaj
   `hasło → pending → user verification → pełna sesja`; ponowne użycie
   challenge ma zostać odrzucone.
5. Dla każdego flow sprawdź wygaśnięcie, złą metodę, pięć błędnych prób,
   jednorazowość challenge oraz brak dostępu/refresh dla tokenu pending.
6. W DevTools → Application sprawdź, że `mfa_token`, assertion, kod OTP,
   `otpauth://` i sekret TOTP nie występują w Local Storage ani Session Storage.

## Granice pomiaru

Mierz dwa żądania osobno:

- inicjacja: od wysłania `POST /auth/login` do odpowiedzi; obejmuje weryfikację
  hasła, utworzenie challenge i — dla e-mail OTP — synchroniczną transmisję i
  akceptację przez lokalny Mailpit SMTP;
- finalizacja: od wysłania endpointu `*/verify` do pełnej odpowiedzi sesji;
  obejmuje weryfikację drugiego czynnika, atomowe zużycie challenge i wydanie
  access/refresh JWT.

Każda próba używa nowego challenge i prawdziwego pierwszego czynnika. Nie mierz
renderowania UI jako czasu backendu. Zapisuj sukces/błąd i kategorię wyniku,
ale nigdy hasła, OTP, sekretu/URI TOTP, JWT, assertion, credential ID ani danych
dostępowych SMTP.
