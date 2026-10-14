require('dotenv').config();
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const routes = require('./routes');
const spec = require('./openapi');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.redirect('/docs'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { swaggerOptions: { persistAuthorization: true } }));
app.get('/openapi.json', (req, res) => res.json(spec));
app.use('/api', routes);

app.use((req, res) => res.status(404).json({ error: 'Topilmadi' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON noto\'g\'ri' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server xatosi' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API: http://localhost:${PORT}/api  |  Docs: http://localhost:${PORT}/docs`));
