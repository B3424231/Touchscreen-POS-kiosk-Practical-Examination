import { createApp } from '../server/server.js';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const dbPath = process.env.POS_DB_PATH || resolve(tmpdir(), 'pos.db');
const { handler } = createApp({ databasePath: dbPath });

export default async function (req, res) {
  return handler(req, res);
}
