import crypto from 'node:crypto';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/cine_test';
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.MUX_TOKEN_ID = 'test-token-id';
process.env.MUX_TOKEN_SECRET = 'test-token-secret';
process.env.MUX_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.MUX_API_BASE = 'https://mux.test';
process.env.LOCAL_STORAGE_DIR = 'storage-test';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.MUX_SIGNING_KEY_ID = 'test-signing-key';
process.env.MUX_SIGNING_PRIVATE_KEY = Buffer.from(privateKey.export({ type: 'pkcs1', format: 'pem' })).toString('base64');
process.env.TEST_MUX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
