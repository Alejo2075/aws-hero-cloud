const express = require('express');

const PORT = process.env.PORT || 3000;
const app = express();

app.get('/healthz', (_req, res) => {
  res.send('ok');
});

app.get('/hello', (_req, res) => {
  res.json({ message: 'hello' });
});

app.listen(PORT);
