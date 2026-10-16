import express from 'express';

const app = express();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(express.static('dist'));

app.listen(process.env.PORT || 8080);
