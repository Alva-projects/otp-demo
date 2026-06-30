# 46elks OTP-demo

Minimal Express-app som skickar en engångskod via SMS och verifierar den, t.ex. innan ett formulär skickas in.

## Kom igång

```bash
npm install
cp .env.example .env   # fyll i ELKS_API_USERNAME, ELKS_API_PASSWORD, ELKS_FROM
npm start
```

Öppna http://localhost:3000

## Endpoints

- `POST /otp/request` `{ phone }` — genererar en 6-siffrig kod, skickar via 46elks SMS-API, giltig i 5 minuter.
- `POST /otp/verify` `{ phone, code }` — verifierar koden (max 5 försök).

Koderna lagras in-memory. Nollställs vid omstart av servern.
