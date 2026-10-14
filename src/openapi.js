const json = (schema) => ({ 'application/json': { schema } });
const body = (schema, example) => ({ required: true, content: { 'application/json': { schema, example } } });
const ok = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const secured = [{ bearerAuth: [] }];
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const errs = {
  401: { description: 'Token yo\'q yoki yaroqsiz' },
  403: { description: 'Ruxsat yo\'q (faqat superadmin)' },
};

const Product = {
  type: 'object',
  properties: {
    id: { type: 'integer', example: 1 },
    name: { type: 'string', example: 'Pepperoni' },
    image: { type: 'string', example: 'https://example.com/pepperoni.jpg' },
    description: { type: 'string', example: 'Pepperoni, mozzarella, tomat sousi' },
    category: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string', example: 'Pitsa' } } },
    sizes: {
      type: 'array',
      items: { type: 'object', properties: { size: { type: 'integer', enum: [22, 28, 33] }, price: { type: 'number' } } },
      example: [{ size: 22, price: 45000 }, { size: 28, price: 65000 }, { size: 33, price: 85000 }],
    },
  },
};
const ProductInput = {
  type: 'object',
  required: ['name', 'category_id', 'prices'],
  properties: {
    name: { type: 'string' },
    image: { type: 'string' },
    description: { type: 'string' },
    category_id: { type: 'integer' },
    prices: {
      type: 'object',
      required: ['22', '28', '33'],
      properties: { 22: { type: 'number' }, 28: { type: 'number' }, 33: { type: 'number' } },
    },
  },
};
const AuthBody = {
  type: 'object',
  required: ['username', 'password'],
  properties: { username: { type: 'string', example: 'ali' }, password: { type: 'string', example: 'secret123' } },
};
const AuthResult = {
  type: 'object',
  properties: {
    user: { type: 'object', properties: { id: { type: 'integer' }, username: { type: 'string' }, role: { type: 'string', enum: ['user', 'superadmin'] } } },
    token: { type: 'string' },
  },
};
const Order = { type: 'object' };

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Pizza API',
    version: '1.0.0',
    description:
      'Pitsa sayti uchun API.\n\n**Avtorizatsiya:** `/api/auth/login` dan token oling, so\'ng yuqoridagi **Authorize** tugmasiga tokenni kiriting.\n\nSuper admin (standart): `admin` / `admin123`.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Auth' }, { name: 'Categories' }, { name: 'Products' }, { name: 'Orders' },
    { name: 'Purchases' }, { name: 'Logo' }, { name: 'Admin' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  paths: {
    '/api/auth/register': {
      post: { tags: ['Auth'], summary: 'Ro\'yxatdan o\'tish', requestBody: body(AuthBody),
        responses: { 201: ok('Yaratildi', AuthResult), 400: { description: 'Validatsiya xatosi' }, 409: { description: 'Username band' } } },
    },
    '/api/auth/login': {
      post: { tags: ['Auth'], summary: 'Login (JWT token olish)', requestBody: body(AuthBody, { username: 'admin', password: 'admin123' }),
        responses: { 200: ok('Muvaffaqiyatli', AuthResult), 401: { description: 'Noto\'g\'ri login yoki parol' } } },
    },
    '/api/auth/me': {
      get: { tags: ['Auth'], summary: 'Joriy foydalanuvchi', security: secured, responses: { 200: ok('Foydalanuvchi'), 401: errs[401] } },
    },

    '/api/categories': {
      get: { tags: ['Categories'], summary: 'Kategoriyalar ro\'yxati', responses: { 200: ok('Ro\'yxat') } },
      post: { tags: ['Categories'], summary: 'Kategoriya yaratish (superadmin)', security: secured,
        requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } }, { name: 'Pitsa' }),
        responses: { 201: ok('Yaratildi'), ...errs, 409: { description: 'Mavjud' } } },
    },
    '/api/categories/{id}': {
      put: { tags: ['Categories'], summary: 'Kategoriyani yangilash (superadmin)', security: secured, parameters: [idParam],
        requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } }),
        responses: { 200: ok('Yangilandi'), ...errs, 404: { description: 'Topilmadi' } } },
      delete: { tags: ['Categories'], summary: 'Kategoriyani o\'chirish (superadmin)', security: secured, parameters: [idParam],
        responses: { 204: { description: 'O\'chirildi' }, ...errs, 404: { description: 'Topilmadi' }, 409: { description: 'Ichida mahsulotlar bor' } } },
    },

    '/api/products': {
      get: { tags: ['Products'], summary: 'Mahsulot kartalari ro\'yxati',
        parameters: [
          { name: 'category_id', in: 'query', schema: { type: 'integer' } },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Nom bo\'yicha qidirish' },
        ],
        responses: { 200: ok('Ro\'yxat', { type: 'array', items: Product }) } },
      post: { tags: ['Products'], summary: 'Mahsulot yaratish (superadmin)', security: secured,
        requestBody: body(ProductInput, {
          name: 'Pepperoni', image: 'https://example.com/pepperoni.jpg', description: 'Pepperoni, mozzarella',
          category_id: 1, prices: { 22: 45000, 28: 65000, 33: 85000 },
        }),
        responses: { 201: ok('Yaratildi', Product), 400: { description: 'Validatsiya xatosi' }, ...errs } },
    },
    '/api/products/{id}': {
      get: { tags: ['Products'], summary: 'Bitta mahsulot', parameters: [idParam],
        responses: { 200: ok('Mahsulot', Product), 404: { description: 'Topilmadi' } } },
      put: { tags: ['Products'], summary: 'Mahsulotni yangilash (superadmin, qisman ham bo\'ladi)', security: secured, parameters: [idParam],
        requestBody: body({ ...ProductInput, required: [] }),
        responses: { 200: ok('Yangilandi', Product), 400: { description: 'Validatsiya xatosi' }, ...errs, 404: { description: 'Topilmadi' } } },
      delete: { tags: ['Products'], summary: 'Mahsulotni o\'chirish (superadmin)', security: secured, parameters: [idParam],
        responses: { 204: { description: 'O\'chirildi' }, ...errs, 404: { description: 'Topilmadi' }, 409: { description: 'Buyurtmalarda ishlatilgan' } } },
    },

    '/api/orders': {
      post: { tags: ['Orders'], summary: 'Buyurtma berish', security: secured,
        requestBody: body({
          type: 'object', required: ['items'],
          properties: { items: { type: 'array', items: { type: 'object', required: ['product_id', 'size', 'quantity'],
            properties: { product_id: { type: 'integer' }, size: { type: 'integer', enum: [22, 28, 33] }, quantity: { type: 'integer', minimum: 1 } } } } },
        }, { items: [{ product_id: 1, size: 28, quantity: 2 }] }),
        responses: { 201: ok('Yaratildi', Order), 400: { description: 'Validatsiya xatosi' }, 401: errs[401] } },
      get: { tags: ['Orders'], summary: 'Barcha buyurtmalar (superadmin)', security: secured, responses: { 200: ok('Ro\'yxat'), ...errs } },
    },
    '/api/orders/my': {
      get: { tags: ['Orders'], summary: 'Mening buyurtmalarim', security: secured, responses: { 200: ok('Ro\'yxat'), 401: errs[401] } },
    },
    '/api/orders/{id}/status': {
      patch: { tags: ['Orders'], summary: 'Buyurtma holatini o\'zgartirish (superadmin)', security: secured, parameters: [idParam],
        requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['new', 'preparing', 'delivered', 'cancelled'] } } }),
        responses: { 200: ok('Yangilandi', Order), ...errs, 404: { description: 'Topilmadi' } } },
    },

    '/api/purchases': {
      get: { tags: ['Purchases'], summary: 'Men sotib olgan tovarlar (bekor qilinmaganlari, mahsulot+razmer bo\'yicha jamlangan)',
        security: secured, responses: { 200: ok('Sotib olingan tovarlar'), 401: errs[401] } },
    },

    '/api/logo': {
      get: { tags: ['Logo'], summary: 'Sayt logotipi', responses: { 200: ok('Logo', { type: 'object', properties: { logo: { type: 'string', nullable: true } } }) } },
      put: { tags: ['Logo'], summary: 'Logotipni o\'rnatish (superadmin)', security: secured,
        requestBody: body({ type: 'object', required: ['logo'], properties: { logo: { type: 'string' } } }, { logo: 'https://example.com/logo.png' }),
        responses: { 200: ok('Saqlandi'), 400: { description: 'Validatsiya xatosi' }, ...errs } },
      delete: { tags: ['Logo'], summary: 'Logotipni o\'chirish (superadmin)', security: secured, responses: { 204: { description: 'O\'chirildi' }, ...errs } },
    },

    '/api/admin/stats': {
      get: { tags: ['Admin'], summary: 'Umumiy statistika (superadmin)', security: secured, responses: { 200: ok('Statistika'), ...errs } },
    },
  },
};
