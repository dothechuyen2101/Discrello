import { openDb } from './db/client';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const handle = await openDb(url);
try {
  await handle.migrate();
  console.log('Migrations applied');
} finally {
  await handle.close();
}
