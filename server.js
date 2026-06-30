import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';

const { ELKS_API_USERNAME, ELKS_API_PASSWORD, ELKS_FROM, PORT = 3000 } = process.env;

if (!ELKS_API_USERNAME || !ELKS_API_PASSWORD || !ELKS_FROM) {
  console.error('Missing 46elks credentials in .env (see .env.example)');
  process.exit(1);
}

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const otps = new Map(); // phone -> { code, expiresAt, attempts }

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/otp/request', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const code = crypto.randomInt(100000, 999999).toString();
  const auth = Buffer.from(`${ELKS_API_USERNAME}:${ELKS_API_PASSWORD}`).toString('base64');

  const response = await fetch('https://api.46elks.com/a1/sms', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      from: ELKS_FROM,
      to: phone,
      message: `Din kod: ${code}`,
    }),
  });

  if (!response.ok) {
    return res.status(502).json({ error: 'failed to send sms' });
  }

  otps.set(phone, { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  res.json({ ok: true });
});

app.post('/otp/verify', (req, res) => {
  const { phone, code } = req.body;
  const entry = otps.get(phone);

  if (!entry) return res.status(400).json({ error: 'no pending code' });

  if (Date.now() > entry.expiresAt) {
    otps.delete(phone);
    return res.status(400).json({ error: 'code expired' });
  }

  entry.attempts += 1;
  if (entry.attempts > MAX_ATTEMPTS) {
    otps.delete(phone);
    return res.status(429).json({ error: 'too many attempts' });
  }

  if (entry.code !== code) {
    return res.status(400).json({ error: 'invalid code' });
  }

  otps.delete(phone);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
