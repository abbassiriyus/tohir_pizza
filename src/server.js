require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const swaggerUi = require('swagger-ui-express');
const routes = require('./routes');
const spec = require('./openapi');
const { UPLOAD_DIR, MAX_MB } = require('./upload');

const app = express();
// nginx kabi lokal proksi ortida to'g'ri protokol/host (rasm URL'lari uchun)
app.set('trust proxy', 'loopback');
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.redirect('/docs'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { swaggerOptions: { persistAuthorization: true } }));
app.get('/openapi.json', (req, res) => res.json(spec));
// Yuklangan rasmlar. nosniff — brauzer faylni rasmdan boshqa narsa deb talqin qilmasin
app.use('/uploads', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));
app.use('/api', routes);

app.use((req, res) => res.status(404).json({ error: 'Topilmadi' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON noto\'g\'ri' });
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Rasm hajmi ${MAX_MB} MB dan oshmasligi kerak`
      : err.code === 'LIMIT_UNEXPECTED_FILE' ? `Kutilmagan fayl maydoni: "${err.field}"` : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server xatosi' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API: http://localhost:${PORT}/api  |  Docs: http://localhost:${PORT}/docs`));
