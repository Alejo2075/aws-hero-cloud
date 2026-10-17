const express = require('express');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
const app = express();

app.get('/health', async (_req, res) => {
  await pool.query('select 1');
  res.json({ ok: true });
});

app.listen(Number(process.env.PORT) || 3000);
