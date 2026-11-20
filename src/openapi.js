const json = (schema) => ({ 'application/json': { schema } });
const body = (schema, example) => ({ required: true, content: { 'application/json': { schema, example } } });
// JSON yoki multipart/form-data (rasm fayli bilan) — ikkalasi ham qabul qilinadi
const jsonOrForm = (jsonSchema, formSchema, example) => ({
  required: true,
  content: { 'application/json': { schema: jsonSchema, example }, 'multipart/form-data': { schema: formSchema } },
});
const ok = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const secured = [{ bearerAuth: [] }];
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const q = (name, schema, description) => ({ name, in: 'query', schema, ...(description ? { description } : {}) });
const errs = {
  401: { description: 'Token yo\'q, yaroqsiz yoki hisob bloklangan' },
  403: { description: 'Bu rol uchun ruxsat yo\'q' },
};
const e400 = { 400: { description: 'Validatsiya xatosi' } };
const e404 = { 404: { description: 'Topilmadi' } };
const e409 = (description) => ({ 409: { description } });

const STATUSES = ['new', 'preparing', 'delivering', 'delivered', 'cancelled'];
const imageNote = 'Rasm: JSON\'da `image` — link (https://...). Yoki `multipart/form-data`: `image` — fayl (JPG/PNG/WEBP/GIF, 5 MB gacha) yoki `image_url` — link.';

const Product = {
  type: 'object',
  properties: {
    id: { type: 'integer', example: 1 },
    name: { type: 'string', example: 'Pepperoni' },
    image: { type: 'string', example: 'https://api.example.uz/uploads/3f1c...e2.jpg' },
    description: { type: 'string', example: 'Pepperoni, mozzarella, tomat sousi' },
    category: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string', example: 'Pitsa' } } },
    branch: { type: 'object', nullable: true, properties: { id: { type: 'integer' }, name: { type: 'string', example: 'Chilonzor' } } },
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
    image: { type: 'string', description: 'Rasm linki (https://...)' },
    description: { type: 'string' },
    category_id: { type: 'integer' },
    branch_id: { type: 'integer', description: 'Faqat superadmin uchun majburiy. Filial adminida avtomatik o\'z filiali' },
    prices: {
      type: 'object',
      required: ['22', '28', '33'],
      properties: { 22: { type: 'number' }, 28: { type: 'number' }, 33: { type: 'number' } },
    },
  },
};
const ProductForm = {
  type: 'object',
  required: ['name', 'category_id', 'price_22', 'price_28', 'price_33'],
  properties: {
    name: { type: 'string' },
    image: { type: 'string', format: 'binary', description: 'Rasm fayli' },
    image_url: { type: 'string', description: 'Yoki rasm linki (fayl yuborilmasa)' },
    description: { type: 'string' },
    category_id: { type: 'integer' },
    branch_id: { type: 'integer', description: 'Faqat superadmin uchun' },
    price_22: { type: 'number' },
    price_28: { type: 'number' },
    price_33: { type: 'number' },
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
    user: {
      type: 'object',
      properties: {
        id: { type: 'integer' }, username: { type: 'string' },
        role: { type: 'string', enum: ['user', 'superadmin', 'branch_admin', 'worker'] },
        branch_id: { type: 'integer', nullable: true },
      },
    },
    token: { type: 'string' },
  },
};
const Order = {
  type: 'object',
  properties: {
    id: { type: 'integer' }, user_id: { type: 'integer' }, username: { type: 'string' },
    total: { type: 'number', example: 130000 },
    status: { type: 'string', enum: STATUSES },
    address: { type: 'string' }, phone: { type: 'string' },
    branch: { type: 'object', nullable: true, properties: { id: { type: 'integer' }, name: { type: 'string' } } },
    worker: { type: 'object', nullable: true, properties: { id: { type: 'integer' }, username: { type: 'string' }, full_name: { type: 'string' } } },
    created_at: { type: 'string' }, accepted_at: { type: 'string', nullable: true }, delivered_at: { type: 'string', nullable: true },
    items: {
      type: 'array',
      items: { type: 'object', properties: { product_id: { type: 'integer' }, name: { type: 'string' }, size: { type: 'integer' }, quantity: { type: 'integer' }, price: { type: 'number' } } },
    },
  },
};
const Orders = { type: 'array', items: Order };
const Staff = {
  type: 'object',
  properties: {
    id: { type: 'integer' }, username: { type: 'string' }, role: { type: 'string' }, branch_id: { type: 'integer' },
    full_name: { type: 'string' }, phone: { type: 'string' }, active: { type: 'integer', enum: [0, 1] }, created_at: { type: 'string' },
  },
};
const NewStaff = {
  type: 'object',
  required: ['username', 'password'],
  properties: { username: { type: 'string' }, password: { type: 'string', minLength: 6 }, full_name: { type: 'string' }, phone: { type: 'string' } },
};
const StaffUpdate = {
  type: 'object',
  properties: {
    full_name: { type: 'string' }, phone: { type: 'string' },
    password: { type: 'string', minLength: 6, description: 'Yangi parol' },
    active: { type: 'boolean', description: 'false — bloklash' },
  },
};
const Branch = {
  type: 'object',
  properties: {
    id: { type: 'integer' }, name: { type: 'string', example: 'Chilonzor' }, address: { type: 'string' }, phone: { type: 'string' },
    active: { type: 'boolean' }, workers: { type: 'integer' }, products: { type: 'integer' },
    admins: { type: 'array', items: Staff },
  },
};
const orderFilters = [
  q('status', { type: 'string', enum: STATUSES }),
  q('limit', { type: 'integer', default: 200, maximum: 1000 }),
];

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Pizza API',
    version: '2.0.0',
    description: [
      'Pitsa tarmog\'i uchun API: filiallar, ishchilar (yetkazib beruvchilar), buyurtmalar.',
      '',
      '**Avtorizatsiya:** `/api/auth/login` dan token oling, so\'ng yuqoridagi **Authorize** tugmasiga tokenni kiriting. Barcha rollar shu bitta login orqali kiradi.',
      '',
      '**Rollar:** `superadmin` — hammasi, filiallar yaratadi · `branch_admin` — o\'z filiali ovqatlari, ishchilari, buyurtmalari · `worker` — buyurtmalarni oladi va yetkazadi · `user` — mijoz.',
      '',
      '**Buyurtma holatlari:** `new` → `preparing` → `delivering` (ishchi oldi) → `delivered`; istalgan paytda `cancelled`.',
      '',
      'Super admin (standart): `admin` / `admin123` — productionda .env orqali o\'zgartiring.',
    ].join('\n'),
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Auth' }, { name: 'Branches', description: 'Filiallar (superadmin)' },
    { name: 'Branch panel', description: 'Filial admini paneli' }, { name: 'Worker panel', description: 'Ishchi paneli' },
    { name: 'Categories' }, { name: 'Products' }, { name: 'Orders' }, { name: 'Purchases' }, { name: 'Logo' }, { name: 'Admin' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  paths: {
    // ---------- Auth ----------
    '/api/auth/register': {
      post: { tags: ['Auth'], summary: 'Mijoz sifatida ro\'yxatdan o\'tish', requestBody: body(AuthBody),
        responses: { 201: ok('Yaratildi', AuthResult), ...e400, ...e409('Username band') } },
    },
    '/api/auth/login': {
      post: { tags: ['Auth'], summary: 'Login — barcha rollar uchun (JWT token olish)', requestBody: body(AuthBody, { username: 'admin', password: 'admin123' }),
        responses: { 200: ok('Muvaffaqiyatli', AuthResult), 401: { description: 'Noto\'g\'ri login yoki parol' }, 403: { description: 'Hisob yoki filial bloklangan' } } },
    },
    '/api/auth/me': {
      get: { tags: ['Auth'], summary: 'Joriy foydalanuvchi (rol va filial bilan)', security: secured, responses: { 200: ok('Foydalanuvchi'), 401: errs[401] } },
    },

    // ---------- Branches (superadmin) ----------
    '/api/branches': {
      get: { tags: ['Branches'], summary: 'Faol filiallar ro\'yxati (ochiq — mijoz filial tanlashi uchun)', responses: { 200: ok('Ro\'yxat') } },
      post: { tags: ['Branches'], summary: 'Filial yaratish (+ ixtiyoriy filial admini hisobi)', security: secured,
        requestBody: body({
          type: 'object', required: ['name'],
          properties: { name: { type: 'string' }, address: { type: 'string' }, phone: { type: 'string' }, admin: NewStaff },
        }, { name: 'Chilonzor', address: 'Chilonzor 9-kvartal', phone: '+998901234567', admin: { username: 'chilonzor_admin', password: 'parol123', full_name: 'Aziz Karimov' } }),
        responses: { 201: ok('Yaratildi', Branch), ...e400, ...errs, ...e409('Nom yoki username band') } },
    },
    '/api/branches/all': {
      get: { tags: ['Branches'], summary: 'Barcha filiallar (faol bo\'lmaganlari ham), adminlari bilan', security: secured,
        responses: { 200: ok('Ro\'yxat', { type: 'array', items: Branch }), ...errs } },
    },
    '/api/branches/{id}': {
      get: { tags: ['Branches'], summary: 'Bitta filial', security: secured, parameters: [idParam], responses: { 200: ok('Filial', Branch), ...errs, ...e404 } },
      put: { tags: ['Branches'], summary: 'Filialni yangilash / yopish (active=false)', security: secured, parameters: [idParam],
        requestBody: body({ type: 'object', properties: { name: { type: 'string' }, address: { type: 'string' }, phone: { type: 'string' }, active: { type: 'boolean' } } }),
        responses: { 200: ok('Yangilandi', Branch), ...e400, ...errs, ...e404, ...e409('Nom band') } },
      delete: { tags: ['Branches'], summary: 'Bo\'sh filialni o\'chirish', security: secured, parameters: [idParam],
        responses: { 204: { description: 'O\'chirildi' }, ...errs, ...e404, ...e409('Filialda ma\'lumot bor — active=false qiling') } },
    },
    '/api/branches/{id}/admins': {
      post: { tags: ['Branches'], summary: 'Filialga admin qo\'shish', security: secured, parameters: [idParam], requestBody: body(NewStaff),
        responses: { 201: ok('Yaratildi', Staff), ...e400, ...errs, ...e404, ...e409('Username band') } },
    },
    '/api/branches/{id}/admins/{userId}': {
      put: { tags: ['Branches'], summary: 'Filial adminini yangilash / bloklash / parolini almashtirish', security: secured,
        parameters: [idParam, { name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: body(StaffUpdate),
        responses: { 200: ok('Yangilandi', Staff), ...e400, ...errs, ...e404 } },
    },

    // ---------- Branch panel ----------
    '/api/branch': {
      get: { tags: ['Branch panel'], summary: 'Mening filialim', security: secured, responses: { 200: ok('Filial'), ...errs } },
    },
    '/api/branch/workers': {
      get: { tags: ['Branch panel'], summary: 'Filial ishchilari (yetkazayotgan/yetkazgan soni bilan)', security: secured, responses: { 200: ok('Ro\'yxat'), ...errs } },
      post: { tags: ['Branch panel'], summary: 'Ishchi yaratish', security: secured,
        requestBody: body(NewStaff, { username: 'jasur_kuryer', password: 'parol123', full_name: 'Jasur Aliyev', phone: '+998901112233' }),
        responses: { 201: ok('Yaratildi', Staff), ...e400, ...errs, ...e409('Username band') } },
    },
    '/api/branch/workers/{id}': {
      put: { tags: ['Branch panel'], summary: 'Ishchini yangilash / bloklash (active=false) / parolini almashtirish', security: secured, parameters: [idParam],
        requestBody: body(StaffUpdate), responses: { 200: ok('Yangilandi', Staff), ...e400, ...errs, ...e404 } },
      delete: { tags: ['Branch panel'], summary: 'Buyurtmasi yo\'q ishchini o\'chirish', security: secured, parameters: [idParam],
        responses: { 204: { description: 'O\'chirildi' }, ...errs, ...e404, ...e409('Buyurtmalari bor — active=false qiling') } },
    },
    '/api/branch/orders': {
      get: { tags: ['Branch panel'], summary: 'Filial buyurtmalari', security: secured,
        parameters: [...orderFilters, q('worker_id', { type: 'string' }, 'Ishchi id yoki `none` (hech kim olmagan)')],
        responses: { 200: ok('Ro\'yxat', Orders), ...errs } },
    },
    '/api/branch/orders/{id}': {
      get: { tags: ['Branch panel'], summary: 'Bitta buyurtma', security: secured, parameters: [idParam], responses: { 200: ok('Buyurtma', Order), ...errs, ...e404 } },
    },
    '/api/branch/orders/{id}/status': {
      patch: { tags: ['Branch panel'], summary: 'Holatni o\'zgartirish (new/preparing ga qaytarilsa ishchi bo\'shatiladi)', security: secured, parameters: [idParam],
        requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['new', 'preparing', 'delivered', 'cancelled'] } } }, { status: 'preparing' }),
        responses: { 200: ok('Yangilandi', Order), ...e400, ...errs, ...e404, ...e409('Buyurtma yakunlangan') } },
    },
    '/api/branch/orders/{id}/assign': {
      patch: { tags: ['Branch panel'], summary: 'Buyurtmani ishchiga biriktirish (holat → delivering)', security: secured, parameters: [idParam],
        requestBody: body({ type: 'object', required: ['worker_id'], properties: { worker_id: { type: 'integer' } } }, { worker_id: 5 }),
        responses: { 200: ok('Biriktirildi', Order), ...e400, ...errs, ...e404, ...e409('Buyurtma yakunlangan') } },
    },
    '/api/branch/stats': {
      get: { tags: ['Branch panel'], summary: 'Filial statistikasi: jami, bugun, 7 kun, har bir ishchi, top mahsulotlar', security: secured,
        responses: { 200: ok('Statistika'), ...errs } },
    },

    // ---------- Worker panel ----------
    '/api/worker/orders': {
      get: { tags: ['Worker panel'], summary: 'Buyurtmalar: available — olinmaganlar (standart), mine — meniki', security: secured,
        parameters: [q('scope', { type: 'string', enum: ['available', 'mine'], default: 'available' }), ...orderFilters],
        responses: { 200: ok('Ro\'yxat', Orders), ...errs } },
    },
    '/api/worker/orders/{id}': {
      get: { tags: ['Worker panel'], summary: 'Bitta buyurtma', security: secured, parameters: [idParam], responses: { 200: ok('Buyurtma', Order), ...errs, ...e404 } },
    },
    '/api/worker/orders/{id}/accept': {
      post: { tags: ['Worker panel'], summary: 'Buyurtmani olish (yetkazishga) → delivering', security: secured, parameters: [idParam],
        responses: { 200: ok('Olindi', Order), ...errs, ...e404, ...e409('Boshqa ishchi olgan yoki holat mos emas') } },
    },
    '/api/worker/orders/{id}/deliver': {
      post: { tags: ['Worker panel'], summary: 'Yetkazildi → delivered', security: secured, parameters: [idParam],
        responses: { 200: ok('Yetkazildi', Order), ...errs, ...e404, ...e409('Bu buyurtma sizda emas') } },
    },
    '/api/worker/orders/{id}/release': {
      post: { tags: ['Worker panel'], summary: 'Buyurtmadan voz kechish → preparing (qayta navbatga)', security: secured, parameters: [idParam],
        responses: { 200: ok('Qaytarildi', Order), ...errs, ...e404, ...e409('Bu buyurtma sizda emas') } },
    },
    '/api/worker/stats': {
      get: { tags: ['Worker panel'], summary: 'Mening statistikam: yetkazganlarim, bugun, 7 kun, o\'rtacha vaqt; filial navbati', security: secured,
        responses: { 200: ok('Statistika'), ...errs } },
    },

    // ---------- Categories ----------
    '/api/categories': {
      get: { tags: ['Categories'], summary: 'Kategoriyalar ro\'yxati', responses: { 200: ok('Ro\'yxat') } },
      post: { tags: ['Categories'], summary: 'Kategoriya yaratish (superadmin)', security: secured,
        requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } }, { name: 'Pitsa' }),
        responses: { 201: ok('Yaratildi'), ...errs, ...e409('Mavjud') } },
    },
    '/api/categories/{id}': {
      put: { tags: ['Categories'], summary: 'Kategoriyani yangilash (superadmin)', security: secured, parameters: [idParam],
        requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string' } } }),
        responses: { 200: ok('Yangilandi'), ...errs, ...e404 } },
      delete: { tags: ['Categories'], summary: 'Kategoriyani o\'chirish (superadmin)', security: secured, parameters: [idParam],
        responses: { 204: { description: 'O\'chirildi' }, ...errs, ...e404, ...e409('Ichida mahsulotlar bor') } },
    },

    // ---------- Products ----------
    '/api/products': {
      get: { tags: ['Products'], summary: 'Mahsulot kartalari (faol filiallar)',
        parameters: [q('branch_id', { type: 'integer' }, 'Filial bo\'yicha'), q('category_id', { type: 'integer' }), q('search', { type: 'string' }, 'Nom bo\'yicha qidirish')],
        responses: { 200: ok('Ro\'yxat', { type: 'array', items: Product }) } },
      post: { tags: ['Products'], summary: 'Mahsulot yaratish (superadmin yoki filial admini)', description: imageNote, security: secured,
        requestBody: jsonOrForm(ProductInput, ProductForm, {
          name: 'Pepperoni', image: 'https://example.com/pepperoni.jpg', description: 'Pepperoni, mozzarella',
          category_id: 1, branch_id: 1, prices: { 22: 45000, 28: 65000, 33: 85000 },
        }),
        responses: { 201: ok('Yaratildi', Product), ...e400, ...errs } },
    },
    '/api/products/{id}': {
      get: { tags: ['Products'], summary: 'Bitta mahsulot', parameters: [idParam], responses: { 200: ok('Mahsulot', Product), ...e404 } },
      put: { tags: ['Products'], summary: 'Mahsulotni yangilash (qisman ham bo\'ladi; filial admini — faqat o\'z filialiniki)', description: imageNote, security: secured, parameters: [idParam],
        requestBody: jsonOrForm({ ...ProductInput, required: [] }, { ...ProductForm, required: [] }),
        responses: { 200: ok('Yangilandi', Product), ...e400, ...errs, ...e404 } },
      delete: { tags: ['Products'], summary: 'Mahsulotni o\'chirish (rasm fayli ham o\'chadi)', security: secured, parameters: [idParam],
        responses: { 204: { description: 'O\'chirildi' }, ...errs, ...e404, ...e409('Buyurtmalarda ishlatilgan') } },
    },

    // ---------- Orders ----------
    '/api/orders': {
      post: { tags: ['Orders'], summary: 'Buyurtma berish (barcha mahsulotlar bitta filialdan)', security: secured,
        requestBody: body({
          type: 'object', required: ['items'],
          properties: {
            items: { type: 'array', items: { type: 'object', required: ['product_id', 'size', 'quantity'],
              properties: { product_id: { type: 'integer' }, size: { type: 'integer', enum: [22, 28, 33] }, quantity: { type: 'integer', minimum: 1 } } } },
            address: { type: 'string', description: 'Yetkazish manzili' },
            phone: { type: 'string', description: 'Aloqa telefoni' },
          },
        }, { items: [{ product_id: 1, size: 28, quantity: 2 }], address: 'Yunusobod 4-kvartal, 12-uy', phone: '+998901234567' }),
        responses: { 201: ok('Yaratildi', Order), ...e400, 401: errs[401] } },
      get: { tags: ['Orders'], summary: 'Barcha buyurtmalar (superadmin)', security: secured,
        parameters: [...orderFilters, q('branch_id', { type: 'integer' }), q('worker_id', { type: 'string' }, 'Ishchi id yoki `none`')],
        responses: { 200: ok('Ro\'yxat', Orders), ...errs } },
    },
    '/api/orders/my': {
      get: { tags: ['Orders'], summary: 'Mening buyurtmalarim', security: secured, responses: { 200: ok('Ro\'yxat', Orders), 401: errs[401] } },
    },
    '/api/orders/{id}/status': {
      patch: { tags: ['Orders'], summary: 'Buyurtma holatini o\'zgartirish (superadmin)', security: secured, parameters: [idParam],
        requestBody: body({ type: 'object', required: ['status'], properties: { status: { type: 'string', enum: STATUSES } } }),
        responses: { 200: ok('Yangilandi', Order), ...errs, ...e404 } },
    },

    '/api/purchases': {
      get: { tags: ['Purchases'], summary: 'Men sotib olgan tovarlar (bekor qilinmaganlari, mahsulot+razmer bo\'yicha jamlangan)',
        security: secured, responses: { 200: ok('Sotib olingan tovarlar'), 401: errs[401] } },
    },

    '/api/logo': {
      get: { tags: ['Logo'], summary: 'Sayt logotipi', responses: { 200: ok('Logo', { type: 'object', properties: { logo: { type: 'string', nullable: true } } }) } },
      put: { tags: ['Logo'], summary: 'Logotipni o\'rnatish (superadmin)',
        description: 'JSON\'da `logo` — link. Yoki `multipart/form-data`: `logo` — fayl yoki `logo_url` — link.', security: secured,
        requestBody: jsonOrForm(
          { type: 'object', required: ['logo'], properties: { logo: { type: 'string' } } },
          { type: 'object', properties: { logo: { type: 'string', format: 'binary' }, logo_url: { type: 'string' } } },
          { logo: 'https://example.com/logo.png' }),
        responses: { 200: ok('Saqlandi'), ...e400, ...errs } },
      delete: { tags: ['Logo'], summary: 'Logotipni o\'chirish (superadmin)', security: secured, responses: { 204: { description: 'O\'chirildi' }, ...errs } },
    },

    '/api/admin/stats': {
      get: { tags: ['Admin'], summary: 'Umumiy statistika, filiallar kesimida (superadmin)', security: secured, responses: { 200: ok('Statistika'), ...errs } },
    },
  },
};
