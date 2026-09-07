# E1 — czas inicjacji MFA

E1 mierzy `T_init`: pole JMeter `elapsed` dla pełnej odpowiedzi `POST /auth/login`. Badane warianty to `NONE`, `EMAIL_OTP`, `TOTP` i `WEBAUTHN`. Drugi etap MFA, Core Web Vitals i analiza hipotez nie należą do E1.

## Protokół

- jeden burst: 50 threadów, 50 kont, 50 `client_slot`, po jednym żądaniu;
- `Synchronizing Timer`: grupa 50, timeout 15 s;
- source IP: sloty `001`–`050` używają `127.0.0.2`–`127.0.0.51` przez `HTTPSampler.ipSource`;
- backend działa bez zmian w kontenerze z `--network host`, więc zachowuje źródłowy adres loopback;
- limiter pozostaje aktywny: preflight oczekuje `201,201,201,201,201,429` z jednego IP, następnie `50/50` bez `429` z 50 IP;
- warm-up: `NONE, EMAIL_OTP, WEBAUTHN, TOTP`;
- pomiar: 12 roundów według zamrożonego, trzykrotnie powtórzonego balanced Williams design;
- 10 s bezczynności przed każdym burstem i 65 s cooldown po każdym roundzie oraz po testach limitera i warm-up;
- EMAIL_OTP używa rzeczywistego synchronicznego SMTP do lokalnego Mailpit: 50 wiadomości warm-up + 600 measured = 650;
- CPU: delta `usage_usec` z cgroup v2; RAM: `memory.current` próbkowane co 20 ms;
- HTTP: keep-alive, brak redirectów i retry, timeout połączenia 5 s, odpowiedzi 60 s;
- odpowiedź jest walidowana semantycznie w pamięci. JTL nie zapisuje body, nagłówków, cookies ani request body.

Każdy błąd harnessu, brak próbki lub `429` zatrzymuje kampanię i zachowuje dotychczasowe raw files. Udokumentowane `503` SMTP w measured EMAIL_OTP pozostaje błędem badanego systemu i nie jest powtarzane. Istniejący katalog runu nigdy nie jest nadpisywany.

## Uruchomienie

Wymagane są `.env`, zweryfikowany istniejący dataset, Docker, Linux z cgroup v2 i Apache JMeter CLI 5.6.3 lub zgodny. Port backendu z `.env` oraz lokalne porty Mailpit `1025` i `8025` muszą być wolne. Harness uruchamia przypięty `axllent/mailpit:v1.31.1` z pustą, efemeryczną bazą.

```bash
npm run test:research
npm run research:e1:preflight
npm run research:e1:pilot
npm run research:e1
```

`research:e1` sam wykonuje preflight Mailpit, testy limitera, warm-up, 12 measured rounds, sanity validation, cleanup challenge i manifest SHA-256. Przed measured runs oba repozytoria muszą być czyste; harness nie wykonuje commitów.

Hasło jest czytane przez JMeter bezpośrednio z `MFA_RESEARCH_PASSWORD` w środowisku procesu. Nie trafia do JMX, parametrów CLI ani wyników.

## Wyniki

Każde uruchomienie dostaje unikalny katalog:

```text
research/results/e1-init/e1-<mode>-<timestamp>-<commit>/
  protocol.json
  environment.json
  preflight/              # w tym mailpit.json
  pilot/ lub warmup/
  rounds/round-01/.../round-12/
  index.csv
  state-before.json
  state-after.json
  SHA256SUMS
```

Każdy burst zachowuje `clients.csv`, `jmeter.jtl`, `jmeter.log`, `resources.csv` i `run.json`. Pilot EMAIL_OTP zapisuje ponadto zredagowane liczniki i metadane w `mailpit.json`, bez OTP, odbiorców i treści wiadomości. Wyniki są ignorowane przez Git. Po pomiarze harness usuwa wyłącznie research `MfaChallenge`, sprawdza dataset oraz niezmienność `totp_last_used_step` i liczników WebAuthn. Golden snapshot nie jest automatycznie odtwarzany.
