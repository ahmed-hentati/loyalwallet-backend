const { Pool } = require('pg');

let pool;

if (process.env.DATABASE_URL) {
  // Parser l'URL manuellement pour éviter le conflit SSL de pg-connection-string
  const url = new URL(process.env.DATABASE_URL);

  pool = new Pool({
    host:     url.hostname,
    port:     parseInt(url.port) || 5432,
    database: url.pathname.replace('/', ''),
    user:     url.username,
    password: url.password,
    ssl:      { rejectUnauthorized: false },
  });
} else {
  pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 5432,
    database: process.env.DB_NAME     || 'loyalwallet',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });
}

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ PostgreSQL connected');
    client.release();
  } catch (err) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { pool, testConnection };