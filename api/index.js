// ============================================
// بانه بابا - Backend API
// نسخه کامل با کاربران، سفارشات، کد تخفیف، جوایز
// ============================================

const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');

// ============================================
// 🔗 اتصال به MongoDB
// ============================================
let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI تعریف نشده');

  const client = await MongoClient.connect(uri);
  const db = client.db('banehbaba');

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

// ============================================
// 🔐 احراز هویت
// ============================================
const JWT_SECRET = process.env.JWT_SECRET || 'banehbaba-secret-change-me';
const USER_TOKEN_SECRET = process.env.USER_TOKEN_SECRET || JWT_SECRET;

function verifyAdmin(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

function verifyUser(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, USER_TOKEN_SECRET);
    if (decoded.role !== 'user') return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

// ============================================
// 🛠 پاسخ استاندارد
// ============================================
function sendJSON(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res.status(status).json(data);
}

// ============================================
// 📸 آپلود عکس در Supabase
// ============================================
async function uploadToSupabase(base64Image) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE تنظیم نشده');

  const matches = base64Image.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!matches) throw new Error('فرمت عکس نامعتبر');

  const extension = matches[1];
  const base64Data = matches[2];
  const buffer = Buffer.from(base64Data, 'base64');

  const fileName = `product-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${extension}`;
  const uploadUrl = `${supabaseUrl}/storage/v1/object/products/${fileName}`;

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': `image/${extension}`,
      'x-upsert': 'true'
    },
    body: buffer
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`خطا در آپلود: ${uploadResponse.status} - ${errText}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/products/${fileName}`;
}

// ============================================
// 🔐 تولید توکن کاربر
// ============================================
function generateUserToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, role: 'user' },
    USER_TOKEN_SECRET,
    { expiresIn: '30d' }
  );
}

// ============================================
// 🚀 هندلر اصلی
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace('/api/', '').replace(/^\//, '');
  const parts = path.split('/').filter(Boolean);
  const resource = parts[0];
  const id = parts[1];

  try {
    const { db } = await connectToDatabase();

    // ============================================
    // 📸 آپلود عکس
    // ============================================
    if (resource === 'upload' && req.method === 'POST') {
      const user = verifyAdmin(req);
      if (!user) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

      const { image } = req.body;
      if (!image) return sendJSON(res, 400, { error: 'عکسی ارسال نشده' });

      try {
        const imageUrl = await uploadToSupabase(image);
        return sendJSON(res, 200, { success: true, url: imageUrl });
      } catch (err) {
        return sendJSON(res, 500, { error: 'خطا در آپلود', message: err.message });
      }
    }

    // ============================================
    // 📦 محصولات
    // ============================================
    if (resource === 'products') {
      const collection = db.collection('products');

      // GET - همه محصولات (عمومی)
      if (req.method === 'GET') {
        if (id) {
          const product = await collection.findOne({ id: Number(id) });
          if (!product) return sendJSON(res, 404, { error: 'محصول یافت نشد' });
          return sendJSON(res, 200, { success: true, product });
        }
        const products = await collection.find({}).sort({ id: 1 }).toArray();
        return sendJSON(res, 200, { success: true, products });
      }

      // POST - افزودن (ادمین)
      if (req.method === 'POST') {
        const user = verifyAdmin(req);
        if (!user) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const product = req.body;
        if (!product.name || !product.price) {
          return sendJSON(res, 400, { error: 'نام و قیمت الزامی' });
        }

        const last = await collection.find({}).sort({ id: -1 }).limit(1).toArray();
        product.id = last.length > 0 ? last[0].id + 1 : 1;
        product.createdAt = new Date();

        await collection.insertOne(product);
        return sendJSON(res, 201, { success: true, product });
      }

      // PUT - ویرایش (ادمین)
      if (req.method === 'PUT') {
        const user = verifyAdmin(req);
        if (!user) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        if (!id) return sendJSON(res, 400, { error: 'ID الزامی' });

        const updates = { ...req.body };
        delete updates._id;
        delete updates.id;

        await collection.updateOne({ id: Number(id) }, { $set: updates });
        return sendJSON(res, 200, { success: true });
      }

      // DELETE (ادمین)
      if (req.method === 'DELETE') {
        const user = verifyAdmin(req);
        if (!user) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        if (!id) return sendJSON(res, 400, { error: 'ID الزامی' });

        await collection.deleteOne({ id: Number(id) });
        return sendJSON(res, 200, { success: true });
      }
    }

    // ============================================
    // 👥 کاربران
    // ============================================
    if (resource === 'users') {
      const collection = db.collection('users');

      // POST /api/users/register → ثبت‌نام
      if (parts[1] === 'register' && req.method === 'POST') {
        const { name, phone, password, province, city, address, postalCode } = req.body;

        if (!name || !phone || !password) {
          return sendJSON(res, 400, { error: 'نام، موبایل و رمز الزامی است' });
        }

        if (phone.length < 10) {
          return sendJSON(res, 400, { error: 'شماره موبایل معتبر نیست' });
        }

        const existing = await collection.findOne({ phone });
        if (existing) {
          return sendJSON(res, 400, { error: 'این شماره قبلاً ثبت‌نام کرده' });
        }

        const user = {
          id: Date.now(),
          name,
          phone,
          password,
          province: province || '',
          city: city || '',
          address: address || '',
          postalCode: postalCode || '',
          registeredAt: new Date(),
          status: 'active'
        };

        await collection.insertOne(user);

        const token = generateUserToken(user);

        return sendJSON(res, 201, {
          success: true,
          token,
          user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            province: user.province,
            city: user.city,
            address: user.address,
            postalCode: user.postalCode
          }
        });
      }

      // POST /api/users/login → ورود
      if (parts[1] === 'login' && req.method === 'POST') {
        const { phone, password } = req.body;

        if (!phone || !password) {
          return sendJSON(res, 400, { error: 'شماره و رمز الزامی است' });
        }

        const user = await collection.findOne({ phone, password });

        if (!user) {
          return sendJSON(res, 401, { error: 'شماره موبایل یا رمز عبور اشتباه است' });
        }

        if (user.status === 'blocked') {
          return sendJSON(res, 403, { error: 'حساب شما مسدود شده است' });
        }

        const token = generateUserToken(user);

        return sendJSON(res, 200, {
          success: true,
          token,
          user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            province: user.province || '',
            city: user.city || '',
            address: user.address || '',
            postalCode: user.postalCode || ''
          }
        });
      }

      // POST /api/users/forgot → فراموشی رمز
      if (parts[1] === 'forgot' && req.method === 'POST') {
        const { phone } = req.body;

        if (!phone) {
          return sendJSON(res, 400, { error: 'شماره موبایل الزامی است' });
        }

        const user = await collection.findOne({ phone });
        if (!user) {
          return sendJSON(res, 404, { error: 'کاربری با این شماره یافت نشد' });
        }

        // ثبت درخواست فراموشی رمز
        const requests = db.collection('password_requests');
        await requests.insertOne({
          id: Date.now(),
          userId: user.id,
          name: user.name,
          phone: user.phone,
          status: 'pending',
          createdAt: new Date()
        });

        return sendJSON(res, 200, {
          success: true,
          message: 'درخواست شما ثبت شد. به‌زودی با شما تماس می‌گیریم'
        });
      }

      // GET /api/users/me → اطلاعات کاربر لاگین‌شده
      if (parts[1] === 'me' && req.method === 'GET') {
        const authUser = verifyUser(req);
        if (!authUser) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const user = await collection.findOne({ id: authUser.id });
        if (!user) return sendJSON(res, 404, { error: 'کاربر یافت نشد' });

        return sendJSON(res, 200, {
          success: true,
          user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            province: user.province || '',
            city: user.city || '',
            address: user.address || '',
            postalCode: user.postalCode || ''
          }
        });
      }

      // PUT /api/users/me → ویرایش اطلاعات کاربر
      if (parts[1] === 'me' && req.method === 'PUT') {
        const authUser = verifyUser(req);
        if (!authUser) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const { name, email, province, city, address, postalCode } = req.body;

        const updates = {};
        if (name) updates.name = name;
        if (email !== undefined) updates.email = email;
        if (province !== undefined) updates.province = province;
        if (city !== undefined) updates.city = city;
        if (address !== undefined) updates.address = address;
        if (postalCode !== undefined) updates.postalCode = postalCode;

        await collection.updateOne({ id: authUser.id }, { $set: updates });

        return sendJSON(res, 200, { success: true, message: 'اطلاعات بروزرسانی شد' });
      }

      // GET /api/users → همه کاربران (ادمین)
      if (req.method === 'GET' && !parts[1]) {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const users = await collection.find({}).toArray();
        return sendJSON(res, 200, { success: true, users });
      }
    }

    // ============================================
    // 🎟️ کد تخفیف
    // ============================================
    if (resource === 'coupons') {
      const collection = db.collection('coupons');

      // POST /api/coupons/check → بررسی کد
      if (parts[1] === 'check' && req.method === 'POST') {
        const { code, amount } = req.body;

        if (!code) return sendJSON(res, 400, { error: 'کد تخفیف الزامی است' });

        const coupon = await collection.findOne({ 
          code: code.toUpperCase(),
          isActive: true 
        });

        if (!coupon) {
          return sendJSON(res, 404, { error: 'کد تخفیف معتبر نیست' });
        }

        // بررسی تاریخ انقضا
        if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
          return sendJSON(res, 400, { error: 'این کد منقضی شده است' });
        }

        // بررسی تعداد استفاده
        if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
          return sendJSON(res, 400, { error: 'ظرفیت استفاده از این کد تمام شده' });
        }

        // بررسی حداقل خرید
        if (coupon.minPurchase && amount < coupon.minPurchase) {
          return sendJSON(res, 400, { 
            error: `حداقل خرید برای این کد ${coupon.minPurchase.toLocaleString('fa-IR')} تومان است` 
          });
        }

        // محاسبه تخفیف
        let discount = 0;
        if (coupon.type === 'percentage') {
          discount = Math.floor(amount * coupon.value / 100);
          if (coupon.maxDiscount && discount > coupon.maxDiscount) {
            discount = coupon.maxDiscount;
          }
        } else {
          discount = coupon.value;
        }

        return sendJSON(res, 200, {
          success: true,
          discount,
          coupon: {
            code: coupon.code,
            type: coupon.type,
            value: coupon.value
          }
        });
      }

      // POST /api/coupons → ساخت کد جدید (ادمین)
      if (req.method === 'POST') {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const { code, type, value, maxUses, minPurchase, maxDiscount, expiresAt } = req.body;

        if (!code || !type || !value) {
          return sendJSON(res, 400, { error: 'کد، نوع و مقدار الزامی است' });
        }

        const existing = await collection.findOne({ code: code.toUpperCase() });
        if (existing) {
          return sendJSON(res, 400, { error: 'این کد قبلاً ساخته شده' });
        }

        const coupon = {
          code: code.toUpperCase(),
          type, // percentage یا fixed
          value: Number(value),
          maxUses: maxUses ? Number(maxUses) : null,
          usedCount: 0,
          minPurchase: minPurchase ? Number(minPurchase) : 0,
          maxDiscount: maxDiscount ? Number(maxDiscount) : null,
          expiresAt: expiresAt || null,
          isActive: true,
          createdAt: new Date()
        };

        await collection.insertOne(coupon);

        return sendJSON(res, 201, { success: true, coupon });
      }

      // GET /api/coupons → لیست کدها (ادمین)
      if (req.method === 'GET') {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const coupons = await collection.find({}).sort({ createdAt: -1 }).toArray();
        return sendJSON(res, 200, { success: true, coupons });
      }

      // DELETE /api/coupons/:id (ادمین)
      if (req.method === 'DELETE' && id) {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        await collection.deleteOne({ code: id });
        return sendJSON(res, 200, { success: true });
      }
    }

    // ============================================
    // 🎁 جوایز
    // ============================================
    if (resource === 'rewards') {
      const collection = db.collection('rewards');

      // GET /api/rewards/my → جوایز من
      if (parts[1] === 'my' && req.method === 'GET') {
        const authUser = verifyUser(req);
        if (!authUser) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const rewards = await collection.find({ 
          userId: authUser.id,
          status: 'active'
        }).toArray();

        return sendJSON(res, 200, { success: true, rewards });
      }

      // POST /api/rewards → ساخت جایزه (ادمین)
      if (req.method === 'POST') {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const { userId, phone, type, value, description, expiresAt } = req.body;

        if (!type || !value) {
          return sendJSON(res, 400, { error: 'نوع و مقدار الزامی است' });
        }

        const reward = {
          id: Date.now(),
          code: 'GIFT' + Date.now().toString().slice(-6),
          userId: userId || null,
          phone: phone || null,
          type, // cash, product, discount
          value: Number(value),
          description: description || '',
          status: 'active',
          expiresAt: expiresAt || null,
          createdAt: new Date()
        };

        await collection.insertOne(reward);
        return sendJSON(res, 201, { success: true, reward });
      }

      // GET /api/rewards (ادمین)
      if (req.method === 'GET') {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const rewards = await collection.find({}).sort({ createdAt: -1 }).toArray();
        return sendJSON(res, 200, { success: true, rewards });
      }
    }

    // ============================================
    // 🛒 سفارشات
    // ============================================
    if (resource === 'orders') {
      const collection = db.collection('orders');

      // POST /api/orders → ثبت سفارش
      if (req.method === 'POST') {
        const order = req.body;

        if (!order.trackingCode || !order.amount) {
          return sendJSON(res, 400, { error: 'اطلاعات سفارش ناقص است' });
        }

        order.id = Date.now();
        order.createdAt = new Date();
        order.status = 'pending';

        // اگه کد تخفیف داشت، تعداد استفاده رو زیاد کن
        if (order.couponCode) {
          const coupons = db.collection('coupons');
          await coupons.updateOne(
            { code: order.couponCode.toUpperCase() },
            { $inc: { usedCount: 1 } }
          );
        }

        await collection.insertOne(order);
        return sendJSON(res, 201, { success: true, order });
      }

      // GET /api/orders/my → سفارشات من
      if (parts[1] === 'my' && req.method === 'GET') {
        const authUser = verifyUser(req);
        if (!authUser) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const orders = await collection
          .find({ 'customer.phone': authUser.phone })
          .sort({ createdAt: -1 })
          .toArray();

        return sendJSON(res, 200, { success: true, orders });
      }

      // GET /api/orders → همه (ادمین)
      if (req.method === 'GET' && !parts[1]) {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const orders = await collection.find({}).sort({ createdAt: -1 }).toArray();
        return sendJSON(res, 200, { success: true, orders });
      }

      // PUT /api/orders/:id → ویرایش وضعیت (ادمین)
      if (req.method === 'PUT' && id) {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const { status, postalTrackingCode } = req.body;
        const updates = {};
        if (status) updates.status = status;
        if (postalTrackingCode) updates.postalTrackingCode = postalTrackingCode;

        await collection.updateOne({ id: Number(id) }, { $set: updates });
        return sendJSON(res, 200, { success: true });
      }

      // DELETE /api/orders/:id (ادمین)
      if (req.method === 'DELETE' && id) {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        await collection.deleteOne({ id: Number(id) });
        return sendJSON(res, 200, { success: true });
      }
    }

    // ============================================
    // 📮 پیگیری سفارش
    // ============================================
    if (resource === 'track' && parts[1]) {
      const collection = db.collection('orders');
      const code = parts[1];

      const order = await collection.findOne({ trackingCode: code });

      if (!order) {
        return sendJSON(res, 404, { error: 'سفارشی با این کد یافت نشد' });
      }

      return sendJSON(res, 200, {
        success: true,
        order: {
          trackingCode: order.trackingCode,
          status: order.status,
          postalTrackingCode: order.postalTrackingCode || '',
          date: order.date,
          amount: order.amount,
          items: order.items || [],
          customer: {
            name: order.customer?.name || order.user?.name || '',
            phone: order.customer?.phone || order.user?.phone || '',
            address: order.customer?.address || '',
            city: order.customer?.city || '',
            province: order.customer?.province || '',
            postalCode: order.customer?.postalCode || ''
          }
        }
      });
    }

    // ============================================
    // 📂 دسته‌بندی‌ها
    // ============================================
    if (resource === 'categories') {
      const collection = db.collection('categories');

      if (req.method === 'GET') {
        const categories = await collection.find({}).toArray();
        return sendJSON(res, 200, { success: true, categories });
      }

      if (req.method === 'POST') {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const category = req.body;
        if (!category.name) return sendJSON(res, 400, { error: 'نام الزامی است' });

        category.id = 'cat_' + Date.now();
        await collection.insertOne(category);
        return sendJSON(res, 201, { success: true, category });
      }
    }

    // ============================================
    // 🔐 ورود ادمین
    // ============================================
    if (resource === 'admin' && parts[1] === 'login') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'متد نامعتبر' });

      const { username, password } = req.body;
      const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'banehbaba2024';

      if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = jwt.sign(
          { username, role: 'admin' },
          JWT_SECRET,
          { expiresIn: '7d' }
        );
        return sendJSON(res, 200, { success: true, token });
      }

      return sendJSON(res, 401, { error: 'نام کاربری یا رمز اشتباه است' });
    }

    // ============================================
    // 💬 پیام‌ها
    // ============================================
    if (resource === 'messages') {
      const collection = db.collection('messages');

      if (req.method === 'POST') {
        const message = req.body;
        message.id = Date.now();
        message.createdAt = new Date();
        await collection.insertOne(message);
        return sendJSON(res, 201, { success: true, message });
      }

      if (req.method === 'GET') {
        const admin = verifyAdmin(req);
        if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const messages = await collection.find({}).sort({ createdAt: -1 }).toArray();
        return sendJSON(res, 200, { success: true, messages });
      }
    }

    // ============================================
    // 📝 درخواست‌های فراموشی رمز (ادمین)
    // ============================================
    if (resource === 'password-requests') {
      const admin = verifyAdmin(req);
      if (!admin) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

      const collection = db.collection('password_requests');

      if (req.method === 'GET') {
        const requests = await collection.find({ status: 'pending' }).sort({ createdAt: -1 }).toArray();
        return sendJSON(res, 200, { success: true, requests });
      }

      if (req.method === 'POST' && parts[1] === 'resolve') {
        const { requestId, newPassword } = req.body;
        
        const request = await collection.findOne({ id: Number(requestId) });
        if (!request) return sendJSON(res, 404, { error: 'درخواست یافت نشد' });

        // تغییر رمز کاربر
        const users = db.collection('users');
        await users.updateOne(
          { id: request.userId },
          { $set: { password: newPassword } }
        );

        // علامت‌گذاری درخواست
        await collection.updateOne(
          { id: Number(requestId) },
          { $set: { status: 'resolved', resolvedAt: new Date() } }
        );

        return sendJSON(res, 200, { success: true, message: 'رمز عبور تغییر کرد' });
      }
    }

    // ============================================
    // 🌐 وضعیت
    // ============================================
    if (resource === '' || resource === 'health') {
      return sendJSON(res, 200, {
        success: true,
        message: 'بانه بابا API فعال است',
        storage: 'Supabase',
        version: '2.0',
        time: new Date().toISOString()
      });
    }

    return sendJSON(res, 404, { error: 'مسیر یافت نشد', path });

  } catch (error) {
    console.error('خطا:', error);
    return sendJSON(res, 500, {
      error: 'خطای سرور',
      message: error.message
    });
  }
};
