import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

const { Client } = pg;

async function createDatabase() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'postgres',
    password: '799020',
    database: 'postgres',
  });

  try {
    await client.connect();
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname = 'shiftly'");
    if (res.rowCount === 0) {
      await client.query('CREATE DATABASE shiftly');
      console.log('✅ Database "shiftly" created successfully');
    } else {
      console.log('ℹ️  Database "shiftly" already exists');
    }
  } catch (err) {
    console.error('❌ Error creating database:', err.message);
  } finally {
    await client.end();
  }
}

createDatabase();
