import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';

const { ELKS_API_USERNAME, ELKS_API_PASSWORD, ELKS_FROM, PORT = 3000 } = process.env;

if (!ELKS_API_USERNAME || !ELKS_API_PASSWORD || !ELKS_FROM) {
  console.error('Missing 46elks credentials in .env (see .env.example)');
  process.exit(1);
}

const OTP_TTL_MS = 5 * 60 * 1000;
const VERIFIED_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_MESSAGE_LENGTH = 160;
const MAX_SMS_PER_PHONE = 5;
const ADMIN_PHONE = '+46760047339';
const otps = new Map(); // phone -> { code, expiresAt, attempts }
const verifiedPhones = new Map(); // phone -> expiresAt
const smsCounts = new Map(); // phone -> number of OTP sms sent

const app = express();
app.use(express.json());
app.use(express.static('public'));

function sendSms(to, message) {
  const auth = Buffer.from(ELKS_API_USERNAME + ':' + ELKS_API_PASSWORD).toString('base64');

  let data = {
    from: ELKS_FROM,
    to: to,
    message: message,
  };

  data = new URLSearchParams(data);
  data = data.toString();

  return fetch('https://api.46elks.com/a1/sms', {
    method: 'post',
    body: data,
    headers: { 'Authorization': 'Basic ' + auth },
  });
}

app.post('/otp/request', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const existing = otps.get(phone);
  if (existing && Date.now() < existing.expiresAt) {
    const retryAfter = Math.ceil((existing.expiresAt - Date.now()) / 1000);
    return res.status(429).json({ error: 'chill and try again later', retryAfter });
  }

  const sentCount = smsCounts.get(phone) ?? 0;
  if (sentCount >= MAX_SMS_PER_PHONE) {
    return res.status(429).json({ error: 'too many codes requested for this number' });
  }

  const code = crypto.randomInt(100000, 999999).toString();
  const response = await sendSms(phone, `Din kod: ${code}`);

  if (!response.ok) {
    return res.status(502).json({ error: 'failed to send sms' });
  }

  otps.set(phone, { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  smsCounts.set(phone, sentCount + 1);
  res.json({ ok: true });
});

app.post('/otp/verify', (req, res) => {
  const { phone, code } = req.body;
  const entry = otps.get(phone);

  if (!entry) return res.status(400).json({ error: 'Waiting for you to do something...' });

  if (Date.now() > entry.expiresAt) {
    otps.delete(phone);
    return res.status(400).json({ error: 'You were too slow. The code has expired.' });
  }

  entry.attempts += 1;
  if (entry.attempts > MAX_ATTEMPTS) {
    otps.delete(phone);
    return res.status(429).json({ error: 'Pls chill, you have done too many attempts.' });
  }

  if (entry.code !== code) {
    return res.status(400).json({ error: 'Can\'t you read? That\'s not the right code.' });
  }

  otps.delete(phone);
  verifiedPhones.set(phone, Date.now() + VERIFIED_TTL_MS);
  res.json({ ok: true });
});

app.post('/form/submit', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` });
  }

  const expiresAt = verifiedPhones.get(phone);
  if (!expiresAt || Date.now() > expiresAt) {
    return res.status(403).json({ error: 'phone not verified' });
  }

  const response = await sendSms(ADMIN_PHONE, `Från ${phone}: ${message}`);
  const elksResponse = await response.json();
  if (!response.ok) {
    return res.status(502).json({ error: 'failed to send sms', elksResponse });
  }

  verifiedPhones.delete(phone); // single use
  res.json({ ok: true, elksResponse });
});

app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
