#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [source, destination] = process.argv.slice(2);
if (!source || !destination)
  throw new Error('Usage: prepare-connection-config.mjs source.json destination.json');
const allowed = new Set([
  'ASTRA_OAUTH_GOOGLE_CLIENT_ID',
  'ASTRA_OAUTH_GOOGLE_CLIENT_SECRET',
  'ASTRA_OAUTH_GOOGLE_READ_CLIENT_ID',
  'ASTRA_OAUTH_GOOGLE_READ_CLIENT_SECRET',
  'ASTRA_OAUTH_GOOGLE_WRITE_CLIENT_ID',
  'ASTRA_OAUTH_GOOGLE_WRITE_CLIENT_SECRET',
  'ASTRA_OAUTH_MICROSOFT_READ_CLIENT_ID',
  'ASTRA_OAUTH_MICROSOFT_WRITE_CLIENT_ID',
]);
const value = JSON.parse(readFileSync(source, 'utf8'));
if (!value || typeof value !== 'object' || Array.isArray(value))
  throw new Error('Expected native OAuth configuration object');
if (Object.keys(value).some((k) => !allowed.has(k)))
  throw new Error('Only native OAuth client configuration is allowed; never package tokens');
if (Object.values(value).some((v) => typeof v !== 'string'))
  throw new Error('Configuration values must be strings');
if (
  value.ASTRA_OAUTH_MICROSOFT_READ_CLIENT_ID &&
  value.ASTRA_OAUTH_MICROSOFT_READ_CLIENT_ID === value.ASTRA_OAUTH_MICROSOFT_WRITE_CLIENT_ID
)
  throw new Error('Microsoft read and send clients must be distinct');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
console.log('Native OAuth client configuration packaged (no user tokens).');
