// ============================================
// بانه بابا - Backend API
// Vercel Serverless Functions
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

function verifyToken(req) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// ============================================
// 🛠 پاسخ‌های استاندارد
// ============================================
function sendJSON(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res.status(status).json(data);
}

// ============================================
// 🚀 هندلر اصلی
// ============================================
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // مسیر درخواست
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace('/api/', '').replace(/^\//, '');
  const parts = path.split('/').filter(Boolean);
  const resource = parts[0];      // products, categories, etc.
  const id = parts[1];             // 123

  try {
    const { db } = await connectToDatabase();

    // ============================================
    // 📦 محصولات
    // ============================================
    if (resource === 'products') {
      const collection = db.collection('products');

      // GET - همه محصولات
      if (req.method === 'GET') {
        if (id) {
          const product = await collection.findOne({ id: Number(id) });
          if (!product) return sendJSON(res, 404, { error: 'محصول یافت نشد' });
          return sendJSON(res, 200, { success: true, product });
        }
        const products = await collection.find({}).sort({ id: 1 }).toArray();
        return sendJSON(res, 200, { success: true, products });
      }

      // POST - افزودن
      if (req.method === 'POST') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const product = req.body;
        if (!product.name || !product.price) {
          return sendJSON(res, 400, { error: 'نام و قیمت الزامی است' });
        }

        const last = await collection.find({}).sort({ id: -1 }).limit(1).toArray();
        product.id = last.length > 0 ? last[0].id + 1 : 1;
        product.createdAt = new Date();

        await collection.insertOne(product);
        return sendJSON(res, 201, { success: true, product });
      }

      // PUT - ویرایش
      if (req.method === 'PUT') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        if (!id) return sendJSON(res, 400, { error: 'ID الزامی است' });

        const updates = { ...req.body };
        delete updates._id;
        delete updates.id;

        await collection.updateOne({ id: Number(id) }, { $set: updates });
        return sendJSON(res, 200, { success: true });
      }

      // DELETE - حذف
      if (req.method === 'DELETE') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        if (!id) return sendJSON(res, 400, { error: 'ID الزامی است' });

        await collection.deleteOne({ id: Number(id) });
        return sendJSON(res, 200, { success: true });
      }
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
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });

        const category = req.body;
        if (!category.name) return sendJSON(res, 400, { error: 'نام الزامی است' });

        category.id = 'cat_' + Date.now();
        await collection.insertOne(category);
        return sendJSON(res, 201, { success: true, category });
      }

      if (req.method === 'PUT') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        if (!id) return sendJSON(res, 400, { error: 'ID الزامی است' });

        const updates = { ...req.body };
        delete updates._id;
        delete updates.id;

        await collection.updateOne({ id }, { $set: updates });
        return sendJSON(res, 200, { success: true });
      }

      if (req.method === 'DELETE') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        if (!id) return sendJSON(res, 400, { error: 'ID الزامی است' });

        await collection.deleteOne({ id });
        return sendJSON(res, 200, { success: true });
      }
    }

    // ============================================
    // 🛒 سفارشات
    // ============================================
    if (resource === 'orders') {
      const collection = db.collection('orders');

      // POST - ثبت سفارش
      if (req.method === 'POST') {
        const order = req.body;
        order.id = Date.now();
        order.createdAt = new Date();
        order.status = 'pending';
        await collection.insertOne(order);
        return sendJSON(res, 201, { success: true, order });
      }

      // GET - همه سفارشات (ادمین)
      if (req.method === 'GET') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        const orders = await collection.find({}).sort({ createdAt: -1 }).toArray();
        return sendJSON(res, 200, { success: true, orders });
      }

      // DELETE
      if (req.method === 'DELETE') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        if (!id) return sendJSON(res, 400, { error: 'ID الزامی است' });
        await collection.deleteOne({ id: Number(id) });
        return sendJSON(res, 200, { success: true });
      }
    }

    // ============================================
    // 👥 کاربران
    // ============================================
    if (resource === 'users') {
      const collection = db.collection('users');

      // POST - ثبت‌نام
      if (req.method === 'POST') {
        const { name, phone, email, password } = req.body;

        if (!name || !phone || !password) {
          return sendJSON(res, 400, { error: 'همه فیلدها لازم است' });
        }

        const existing = await collection.findOne({ phone });
        if (existing) {
          return sendJSON(res, 400, { error: 'این شماره قبلاً ثبت‌نام کرده' });
        }

        const user = {
          id: Date.now(),
          name,
          phone,
          email: email || '',
          password,
          registeredAt: new Date()
        };

        await collection.insertOne(user);
        return sendJSON(res, 201, {
          success: true,
          user: { id: user.id, name, phone, email }
        });
      }

      // GET - همه کاربران (ادمین)
      if (req.method === 'GET') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        const users = await collection.find({}).toArray();
        return sendJSON(res, 200, { success: true, users });
      }
    }

    // ============================================
    // 🔐 ورود ادمین
    // ============================================
    if (resource === 'admin' && parts[1] === 'login') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'متد پشتیبانی نمی‌شود' });

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

      // POST - پیام جدید
      if (req.method === 'POST') {
        const message = req.body;
        message.id = Date.now();
        message.createdAt = new Date();
        await collection.insertOne(message);
        return sendJSON(res, 201, { success: true, message });
      }

      // GET - همه پیام‌ها (ادمین)
      if (req.method === 'GET') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        const messages = await collection.find({}).sort({ createdAt: -1 }).toArray();
        return sendJSON(res, 200, { success: true, messages });
      }

      // DELETE
      if (req.method === 'DELETE') {
        if (!verifyToken(req)) return sendJSON(res, 401, { error: 'دسترسی ندارید' });
        if (!id) return sendJSON(res, 400, { error: 'ID الزامی است' });
        await collection.deleteOne({ id: Number(id) });
        return sendJSON(res, 200, { success: true });
      }
    }

    // ============================================
    // 🌐 وضعیت
    // ============================================
    if (resource === '' || resource === 'health') {
      return sendJSON(res, 200, {
        success: true,
        message: 'بانه بابا API فعال است',
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
