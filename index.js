import express from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { Bot, session, webhookCallback, InlineKeyboard, Keyboard } from 'grammy';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || '');
const WEBHOOK_URL = String(process.env.WEBHOOK_URL || '').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 3000);
const MANAGER_USERNAME = process.env.MANAGER_USERNAME || 'your_manager_username';
const STORE_NAME = process.env.STORE_NAME || 'Consultant Bot';
const TIME_ZONE = process.env.TIME_ZONE || 'Asia/Tashkent';
const DAILY_BROADCAST_HOUR = Number(process.env.DAILY_BROADCAST_HOUR || 12);
const DAILY_BROADCAST_MINUTE = Number(process.env.DAILY_BROADCAST_MINUTE || 0);

if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

const app = express();
app.use(express.json());

const bot = new Bot(BOT_TOKEN);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const KNOWLEDGE_PATH = path.join(DATA_DIR, 'knowledge.json');

const CATEGORIES = [
  'Футболки и поло',
  'Рубашки',
  'Худи и свитшоты',
  'Толстовки',
  'Джинсы',
  'Брюки',
  'Шорты',
  'Верхняя одежда',
  'Спортивная одежда',
  'Обувь',
  'Аксессуары'
];

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify(
        {
          users: [],
          products: [],
          settings: {
            dailyBroadcastTextRu: `🔥 Новые поступления и акции уже доступны! Загляните в каталог ${STORE_NAME}.`,
            dailyBroadcastTextUz: `🔥 Yangi mahsulotlar va aksiyalar tayyor! ${STORE_NAME} katalogiga kirib ko‘ring.`
          }
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  if (!fs.existsSync(KNOWLEDGE_PATH)) {
    fs.writeFileSync(
      KNOWLEDGE_PATH,
      JSON.stringify(
        {
          ru: [
            {
              q: 'Есть ли доставка?',
              a: 'Да, доставка обсуждается с менеджером. Нажмите кнопку связи.'
            }
          ],
          uz: [
            {
              q: 'Dostavka bormi?',
              a: 'Ha, yetkazib berish bo‘yicha menejer bilan bog‘laning.'
            }
          ]
        },
        null,
        2
      ),
      'utf-8'
    );
  }
}

ensureDataFiles();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function loadDb() {
  return readJson(DB_PATH);
}

function saveDb(db) {
  writeJson(DB_PATH, db);
}

function loadKnowledge() {
  return readJson(KNOWLEDGE_PATH);
}

function isAdmin(ctx) {
  return String(ctx.from?.id || '') === ADMIN_ID;
}

function defaultSession() {
  return {
    lang: 'ru',
    state: null,
    tempProduct: {
      photo: '',
      category: '',
      name: '',
      description: '',
      price: ''
    }
  };
}

bot.use(session({ initial: defaultSession }));

function mainMenu(lang = 'ru') {
  if (lang === 'uz') {
    return new Keyboard()
      .text('🛍 Katalog').text('🔥 Yangi mahsulotlar').row()
      .text('🎁 Aksiyalar').text('☎️ Aloqa').row()
      .text('ℹ️ Biz haqimizda').text('🌐 Til')
      .resized();
  }

  return new Keyboard()
    .text('🛍 Каталог').text('🔥 Новинки').row()
    .text('🎁 Акции').text('☎️ Связь').row()
    .text('ℹ️ О нас').text('🌐 Язык')
    .resized();
}

function adminMenu() {
  return new Keyboard()
    .text('➕ Добавить товар').row()
    .text('📦 Список товаров').row()
    .text('📣 Рассылка').row()
    .text('📊 Статистика').row()
    .text('🏠 Главное меню')
    .resized();
}

function categoriesKeyboard(lang = 'ru') {
  const keyboard = new Keyboard();

  for (const category of CATEGORIES) {
    keyboard.text(category).row();
  }

  if (lang === 'uz') {
    keyboard.text('⬅️ Orqaga');
  } else {
    keyboard.text('⬅️ Назад');
  }

  return keyboard.resized();
}

function langText(ctx, ru, uz) {
  return ctx.session.lang === 'uz' ? uz : ru;
}

function registerUser(ctx) {
  const db = loadDb();
  const chatId = String(ctx.chat?.id || '');
  const existing = db.users.find((u) => String(u.chatId) === chatId);

  if (!existing) {
    db.users.push({
      chatId,
      userId: String(ctx.from?.id || ''),
      username: ctx.from?.username || '',
      firstName: ctx.from?.first_name || '',
      lastName: ctx.from?.last_name || '',
      lang: ctx.session.lang || 'ru',
      createdAt: new Date().toISOString()
    });
    saveDb(db);
  } else {
    existing.username = ctx.from?.username || existing.username;
    existing.firstName = ctx.from?.first_name || existing.firstName;
    existing.lastName = ctx.from?.last_name || existing.lastName;
    existing.lang = ctx.session.lang || existing.lang || 'ru';
    saveDb(db);
  }
}

function productCaption(product) {
  return `${product.name}\n\n${product.description}\n\nЦена: ${Number(product.price).toLocaleString('ru-RU')} сум`;
}

function productKeyboard() {
  return new InlineKeyboard()
    .url('☎️ Связаться', `https://t.me/${MANAGER_USERNAME.replace('@', '')}`);
}

async function sendProductCard(ctx, product) {
  const caption = productCaption(product);

  if (product.photo) {
    await ctx.replyWithPhoto(product.photo, {
      caption,
      reply_markup: productKeyboard()
    });
  } else {
    await ctx.reply(caption, {
      reply_markup: productKeyboard()
    });
  }
}

function getProductsByCategory(category) {
  const db = loadDb();
  return db.products.filter((p) => p.category === category);
}

function getNewestProducts(limit = 10) {
  const db = loadDb();
  return [...db.products]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

function getPromoText(lang) {
  if (lang === 'uz') {
    return '🎁 Aksiya va maxsus takliflar uchun menejer bilan bog‘laning.';
  }
  return '🎁 Актуальные акции и спецпредложения уточняйте у менеджера.';
}

function getAboutText(lang) {
  if (lang === 'uz') {
    return `${STORE_NAME} — o‘smirlar kiyimlari do‘koni. Katalogni ko‘ring va buyurtma uchun menejer bilan bog‘laning.`;
  }
  return `${STORE_NAME} — магазин подростковой одежды. Смотрите каталог и связывайтесь с менеджером для заказа.`;
}

function findKnowledgeAnswer(text, lang) {
  const knowledge = loadKnowledge();
  const list = knowledge[lang] || [];
  const normalized = text.toLowerCase();

  for (const item of list) {
    if (
      normalized.includes(item.q.toLowerCase()) ||
      item.q.toLowerCase().includes(normalized)
    ) {
      return item.a;
    }
  }

  return null;
}

async function askOpenAI(question, lang) {
  if (!openai) return null;

  const systemPrompt =
    lang === 'uz'
      ? `Siz ${STORE_NAME} do‘koni uchun foydali va qisqa savdo-maslahatchisiz. Faqat kiyim, buyurtma, yetkazib berish, o‘lcham, narx, aloqa kabi mavzularda javob bering. Agar aniq ma'lumot bo‘lmasa, menejer bilan bog‘lanishni tavsiya qiling. Javoblar qisqa bo‘lsin.`
      : `Ты полезный и краткий консультант магазина ${STORE_NAME}. Отвечай только по темам одежды, заказа, доставки, размеров, цен и связи. Если точной информации нет, рекомендуй связаться с менеджером. Ответы должны быть короткими.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question }
      ],
      temperature: 0.5,
      max_tokens: 250
    });

    return response.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error('OpenAI error:', error.message);
    return null;
  }
}

async function showMainMenu(ctx) {
  await ctx.reply(
    langText(
      ctx,
      `Добро пожаловать в ${STORE_NAME}! Выберите раздел:`,
      `${STORE_NAME} ga xush kelibsiz! Bo‘limni tanlang:`
    ),
    {
      reply_markup: mainMenu(ctx.session.lang)
    }
  );
}

bot.command('start', async (ctx) => {
  registerUser(ctx);
  await showMainMenu(ctx);
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('У вас нет доступа.');
  }

  await ctx.reply('Админ-панель:', {
    reply_markup: adminMenu()
  });
});

bot.hears('🏠 Главное меню', async (ctx) => {
  ctx.session.state = null;
  await showMainMenu(ctx);
});

bot.hears(['🌐 Язык', '🌐 Til'], async (ctx) => {
  await ctx.reply('Выберите язык / Tilni tanlang:', {
    reply_markup: new Keyboard()
      .text('🇷🇺 Русский')
      .text('🇺🇿 O‘zbekcha')
      .resized()
  });
});

bot.hears('🇷🇺 Русский', async (ctx) => {
  ctx.session.lang = 'ru';
  registerUser(ctx);
  await showMainMenu(ctx);
});

bot.hears('🇺🇿 O‘zbekcha', async (ctx) => {
  ctx.session.lang = 'uz';
  registerUser(ctx);
  await showMainMenu(ctx);
});

bot.hears(['🛍 Каталог', '🛍 Katalog'], async (ctx) => {
  await ctx.reply(
    langText(ctx, 'Выберите категорию:', 'Kategoriyani tanlang:'),
    {
      reply_markup: categoriesKeyboard(ctx.session.lang)
    }
  );
});

bot.hears(['⬅️ Назад', '⬅️ Orqaga'], async (ctx) => {
  await showMainMenu(ctx);
});

for (const category of CATEGORIES) {
  bot.hears(category, async (ctx) => {
    const products = getProductsByCategory(category);

    if (!products.length) {
      return ctx.reply(
        langText(
          ctx,
          'В этой категории пока нет товаров.',
          'Bu kategoriyada hozircha mahsulot yo‘q.'
        )
      );
    }

    await ctx.reply(
      langText(
        ctx,
        `Товары в категории: ${category}`,
        `${category} kategoriyasidagi mahsulotlar`
      )
    );

    for (const product of products) {
      await sendProductCard(ctx, product);
    }
  });
}

bot.hears(['🔥 Новинки', '🔥 Yangi mahsulotlar'], async (ctx) => {
  const products = getNewestProducts(10);

  if (!products.length) {
    return ctx.reply(
      langText(
        ctx,
        'Пока нет новых товаров.',
        'Hozircha yangi mahsulotlar yo‘q.'
      )
    );
  }

  await ctx.reply(
    langText(ctx, '🔥 Новинки:', '🔥 Yangi mahsulotlar:')
  );

  for (const product of products) {
    await sendProductCard(ctx, product);
  }
});

bot.hears(['🎁 Акции', '🎁 Aksiyalar'], async (ctx) => {
  await ctx.reply(getPromoText(ctx.session.lang));
});

bot.hears(['☎️ Связь', '☎️ Aloqa'], async (ctx) => {
  await ctx.reply(
    langText(
      ctx,
      `Связь с менеджером: https://t.me/${MANAGER_USERNAME.replace('@', '')}`,
      `Menejer bilan aloqa: https://t.me/${MANAGER_USERNAME.replace('@', '')}`
    )
  );
});

bot.hears(['ℹ️ О нас', 'ℹ️ Biz haqimizda'], async (ctx) => {
  await ctx.reply(getAboutText(ctx.session.lang));
});

bot.hears('➕ Добавить товар', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('У вас нет доступа.');

  ctx.session.state = 'add_product_photo';
  ctx.session.tempProduct = {
    photo: '',
    category: '',
    name: '',
    description: '',
    price: ''
  };

  await ctx.reply('Отправьте фото товара.');
});

bot.hears('📦 Список товаров', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('У вас нет доступа.');

  const db = loadDb();

  if (!db.products.length) {
    return ctx.reply('Товаров пока нет.');
  }

  for (const product of db.products) {
    await ctx.reply(
      `ID: ${product.id}\nКатегория: ${product.category}\nНазвание: ${product.name}\nЦена: ${Number(product.price).toLocaleString('ru-RU')} сум`
    );
  }
});

bot.hears('📣 Рассылка', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('У вас нет доступа.');

  ctx.session.state = 'broadcast_text';
  await ctx.reply('Отправьте текст для рассылки всем пользователям.');
});

bot.hears('📊 Статистика', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('У вас нет доступа.');

  const db = loadDb();

  await ctx.reply(
    `Пользователей: ${db.users.length}\nТоваров: ${db.products.length}`
  );
});

bot.on('message:photo', async (ctx) => {
  if (!isAdmin(ctx)) return;

  if (ctx.session.state !== 'add_product_photo') return;

  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];
  ctx.session.tempProduct.photo = largest.file_id;
  ctx.session.state = 'add_product_category';

  await ctx.reply('Теперь отправьте категорию товара из списка ниже:', {
    reply_markup: categoriesKeyboard('ru')
  });
});

bot.on('message:text', async (ctx, next) => {
  registerUser(ctx);

  if (isAdmin(ctx)) {
    if (ctx.session.state === 'add_product_category') {
      const category = ctx.message.text;

      if (!CATEGORIES.includes(category)) {
        return ctx.reply('Пожалуйста, выберите категорию кнопкой.');
      }

      ctx.session.tempProduct.category = category;
      ctx.session.state = 'add_product_name';
      return ctx.reply('Введите название товара:');
    }

    if (ctx.session.state === 'add_product_name') {
      ctx.session.tempProduct.name = ctx.message.text;
      ctx.session.state = 'add_product_description';
      return ctx.reply('Введите описание товара:');
    }

    if (ctx.session.state === 'add_product_description') {
      ctx.session.tempProduct.description = ctx.message.text;
      ctx.session.state = 'add_product_price';
      return ctx.reply('Введите цену в сумах, только число:');
    }

    if (ctx.session.state === 'add_product_price') {
      const price = ctx.message.text.replace(/[^\d]/g, '');

      if (!price) {
        return ctx.reply('Цена должна быть числом. Попробуйте ещё раз.');
      }

      ctx.session.tempProduct.price = price;

      const db = loadDb();
      const newProduct = {
        id: Date.now(),
        photo: ctx.session.tempProduct.photo,
        category: ctx.session.tempProduct.category,
        name: ctx.session.tempProduct.name,
        description: ctx.session.tempProduct.description,
        price: Number(ctx.session.tempProduct.price),
        createdAt: new Date().toISOString()
      };

      db.products.push(newProduct);
      saveDb(db);

      ctx.session.state = null;
      ctx.session.tempProduct = defaultSession().tempProduct;

      await ctx.reply('Товар успешно добавлен.', {
        reply_markup: adminMenu()
      });

      return sendProductCard(ctx, newProduct);
    }

    if (ctx.session.state === 'broadcast_text') {
      const db = loadDb();
      const text = ctx.message.text;
      let sent = 0;
      let failed = 0;

      await ctx.reply(`Начинаю рассылку по ${db.users.length} пользователям...`);

      for (const user of db.users) {
        try {
          await bot.api.sendMessage(user.chatId, text);
          sent++;
        } catch (error) {
          failed++;
          console.error(`Broadcast error to ${user.chatId}:`, error.message);
        }
      }

      ctx.session.state = null;
      return ctx.reply(`Рассылка завершена.\nОтправлено: ${sent}\nОшибок: ${failed}`, {
        reply_markup: adminMenu()
      });
    }
  }

  const text = ctx.message.text;

  const knownAnswer = findKnowledgeAnswer(text, ctx.session.lang);
  if (knownAnswer) {
    return ctx.reply(knownAnswer);
  }

  if (
    text.startsWith('/') ||
    [
      '🛍 Каталог',
      '🛍 Katalog',
      '🔥 Новинки',
      '🔥 Yangi mahsulotlar',
      '🎁 Акции',
      '🎁 Aksiyalar',
      '☎️ Связь',
      '☎️ Aloqa',
      'ℹ️ О нас',
      'ℹ️ Biz haqimizda',
      '🌐 Язык',
      '🌐 Til',
      '🇷🇺 Русский',
      '🇺🇿 O‘zbekcha',
      '⬅️ Назад',
      '⬅️ Orqaga',
      '➕ Добавить товар',
      '📦 Список товаров',
      '📣 Рассылка',
      '📊 Статистика',
      '🏠 Главное меню',
      ...CATEGORIES
    ].includes(text)
  ) {
    return next();
  }

  const aiAnswer = await askOpenAI(text, ctx.session.lang);

  if (aiAnswer) {
    return ctx.reply(aiAnswer);
  }

  return ctx.reply(
    langText(
      ctx,
      'Я могу помочь по товарам, заказу, доставке и связи с менеджером.',
      'Men mahsulotlar, buyurtma, yetkazib berish va menejer bilan aloqa bo‘yicha yordam bera olaman.'
    )
  );
});

app.get('/', (req, res) => {
  res.send('Consultant Bot is running');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: STORE_NAME });
});

app.use('/webhook', webhookCallback(bot, 'express'));

async function setWebhookIfNeeded() {
  if (!WEBHOOK_URL) {
    console.warn('WEBHOOK_URL is empty. Webhook was not set.');
    return;
  }

  const webhook = `${WEBHOOK_URL}/webhook`;
  await bot.api.setWebhook(webhook);
  console.log(`Webhook set to: ${webhook}`);
}

function getTashkentTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);

  return { hour, minute };
}

let lastBroadcastKey = '';

async function runDailyBroadcastCheck() {
  const now = new Date();

  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const { hour, minute } = getTashkentTimeParts(now);

  if (hour !== DAILY_BROADCAST_HOUR || minute !== DAILY_BROADCAST_MINUTE) {
    return;
  }

  const currentKey = `${dateKey}-${hour}-${minute}`;

  if (lastBroadcastKey === currentKey) {
    return;
  }

  lastBroadcastKey = currentKey;

  const db = loadDb();
  let sent = 0;

  for (const user of db.users) {
    try {
      const text =
        user.lang === 'uz'
          ? db.settings.dailyBroadcastTextUz
          : db.settings.dailyBroadcastTextRu;

      await bot.api.sendMessage(user.chatId, text, {
        reply_markup: mainMenu(user.lang || 'ru')
      });

      sent++;
    } catch (error) {
      console.error(`Daily broadcast failed for ${user.chatId}:`, error.message);
    }
  }

  console.log(`Daily broadcast sent: ${sent}`);
}

setInterval(() => {
  runDailyBroadcastCheck().catch((error) => {
    console.error('Broadcast scheduler error:', error.message);
  });
}, 30000);

app.listen(PORT, async () => {
  console.log(`Server started on port ${PORT}`);

  try {
    await setWebhookIfNeeded();
  } catch (error) {
    console.error('Webhook setup error:', error.message);
  }
});
