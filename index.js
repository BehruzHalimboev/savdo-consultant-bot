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
const DAILY_BROADCAST_HOUR = Number(process.env.DAILY_BROADCAST_HOUR || 12);
const DAILY_BROADCAST_MINUTE = Number(process.env.DAILY_BROADCAST_MINUTE || 0);

if (!BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

const app = express();
app.use(express.json());

const bot = new Bot(BOT_TOKEN);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');
const KNOWLEDGE_PATH = path.join(process.cwd(), 'data', 'knowledge.json');

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

function categoriesMenu() {
  const kb = new Keyboard().resized();
  for (const category of CATEGORIES) kb.text(category).row();
  kb.text('⬅️ Назад');
  return kb;
}

function languageMenu() {
  return new Keyboard()
    .text('Русский')
    .text("O'zbekcha")
    .resized();
}

function contactInline(lang = 'ru') {
  return new InlineKeyboard().url(
    lang === 'uz' ? "☎️ Menejer bilan bog'lanish" : '☎️ Связаться с менеджером',
    `https://t.me/${MANAGER_USERNAME}`
  );
}

function adminMenu() {
  return new Keyboard()
    .text('➕ Добавить товар').row()
    .text('📦 Мои товары').row()
    .text('📢 Рассылка').row()
    .text('📊 Статистика').row()
    .text('⬅️ В меню')
    .resized();
}

bot.use(session({
  initial: () => ({
    lang: 'ru',
    step: null,
    newProduct: {}
  })
}));

async function registerUser(ctx) {
  const db = loadDb();
  const userId = String(ctx.from.id);
  if (!db.users.includes(userId)) {
    db.users.push(userId);
    saveDb(db);
  }
}

bot.command('start', async (ctx) => {
  await registerUser(ctx);
  await ctx.reply(
    'Добро пожаловать в Consultant Bot / Consultant Bot ga xush kelibsiz',
    { reply_markup: languageMenu() }
  );
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Нет доступа');
  await ctx.reply('Админ-панель', { reply_markup: adminMenu() });
});

bot.hears('Русский', async (ctx) => {
  ctx.session.lang = 'ru';
  await ctx.reply('Язык установлен: Русский', { reply_markup: mainMenu('ru') });
});

bot.hears("O'zbekcha", async (ctx) => {
  ctx.session.lang = 'uz';
  await ctx.reply("Til o'rnatildi: O'zbekcha", { reply_markup: mainMenu('uz') });
});

bot.hears(['🌐 Язык', '🌐 Til'], async (ctx) => {
  await ctx.reply('Выберите язык / Tilni tanlang', { reply_markup: languageMenu() });
});

bot.hears(['🛍 Каталог', '🛍 Katalog'], async (ctx) => {
  await ctx.reply(
    ctx.session.lang === 'uz' ? 'Kategoriyani tanlang:' : 'Выберите категорию:',
    { reply_markup: categoriesMenu() }
  );
});

bot.hears('⬅️ Назад', async (ctx) => {
  await ctx.reply(
    ctx.session.lang === 'uz' ? 'Asosiy menyu' : 'Главное меню',
    { reply_markup: mainMenu(ctx.session.lang) }
  );
});

for (const category of CATEGORIES) {
  bot.hears(category, async (ctx) => {
    const db = loadDb();
    const products = db.products.filter(p => p.category === category);

    if (!products.length) {
      return ctx.reply(
        ctx.session.lang === 'uz'
          ? 'Bu kategoriyada hozircha mahsulot yo‘q.'
          : 'В этой категории пока нет товаров.'
      );
    }

    for (const p of products) {
      const text =
        `🛍 ${p.name}\n\n${p.description}\n\n💵 Цена: ${Number(p.price).toLocaleString('ru-RU')} сум`;

      if (p.photoFileId) {
        await ctx.replyWithPhoto(p.photoFileId, {
          caption: text,
          reply_markup: contactInline(ctx.session.lang)
        });
      } else {
        await ctx.reply(text, {
          reply_markup: contactInline(ctx.session.lang)
        });
      }
    }
  });
}

bot.hears(['☎️ Связь', '☎️ Aloqa'], async (ctx) => {
  await ctx.reply(
    ctx.session.lang === 'uz'
      ? "Bog'lanish uchun tugmani bosing:"
      : 'Для связи нажмите кнопку ниже:',
    { reply_markup: contactInline(ctx.session.lang) }
  );
});

bot.hears(['ℹ️ О нас', 'ℹ️ Biz haqimizda'], async (ctx) => {
  await ctx.reply(
    ctx.session.lang === 'uz'
      ? `${STORE_NAME} — o‘smirlar kiyimlari do‘koni. Zamonaviy va qulay kiyimlar.`
      : `${STORE_NAME} — магазин подростковой одежды. Современные и удобные модели.`
  );
});

bot.hears(['🔥 Новинки', '🔥 Yangi mahsulotlar'], async (ctx) => {
  const db = loadDb();
  const latest = db.products.slice(-5);

  if (!latest.length) {
    return ctx.reply(ctx.session.lang === 'uz' ? "Hozircha yangilik yo'q." : 'Пока новинок нет.');
  }

  for (const p of latest) {
    const text = `🔥 ${p.name}\n${p.description}\n💵 ${Number(p.price).toLocaleString('ru-RU')} сум`;
    if (p.photoFileId) {
      await ctx.replyWithPhoto(p.photoFileId, {
        caption: text,
        reply_markup: contactInline(ctx.session.lang)
      });
    } else {
      await ctx.reply(text, { reply_markup: contactInline(ctx.session.lang) });
    }
  }
});

bot.hears(['🎁 Акции', '🎁 Aksiyalar'], async (ctx) => {
  await ctx.reply(
    ctx.session.lang === 'uz'
      ? "Aksiyalar haqida ma'lumotni menejerdan oling."
      : 'Информацию об акциях уточняйте у менеджера.',
    { reply_markup: contactInline(ctx.session.lang) }
  );
});

bot.hears('➕ Добавить товар', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.step = 'product_category';
  ctx.session.newProduct = {};
  await ctx.reply('Выберите категорию:', { reply_markup: categoriesMenu() });
});

bot.hears('📦 Мои товары', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const db = loadDb();
  if (!db.products.length) return ctx.reply('Товаров пока нет.');

  for (const p of db.products) {
    const text = `ID: ${p.id}\nКатегория: ${p.category}\nНазвание: ${p.name}\nЦена: ${p.price} сум`;
    if (p.photoFileId) {
      await ctx.replyWithPhoto(p.photoFileId, { caption: text });
    } else {
      await ctx.reply(text);
    }
  }
});

bot.hears('📊 Статистика', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const db = loadDb();
  await ctx.reply(`Пользователей: ${db.users.length}\nТоваров: ${db.products.length}`);
});

bot.hears('📢 Рассылка', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.step = 'broadcast_text';
  await ctx.reply('Отправьте текст для рассылки всем пользователям:');
});

bot.hears('⬅️ В меню', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply('Главное меню', { reply_markup: mainMenu(ctx.session.lang) });
});

bot.on('message:text', async (ctx) => {
  await registerUser(ctx);

  if (isAdmin(ctx) && ctx.session.step === 'product_category') {
    if (!CATEGORIES.includes(ctx.message.text)) {
      return ctx.reply('Пожалуйста, выберите категорию кнопкой.');
    }
    ctx.session.newProduct.category = ctx.message.text;
    ctx.session.step = 'product_name';
    return ctx.reply('Введите название товара:');
  }

  if (isAdmin(ctx) && ctx.session.step === 'product_name') {
    ctx.session.newProduct.name = ctx.message.text;
    ctx.session.step = 'product_description';
    return ctx.reply('Введите описание товара:');
  }

  if (isAdmin(ctx) && ctx.session.step === 'product_description') {
    ctx.session.newProduct.description = ctx.message.text;
    ctx.session.step = 'product_price';
    return ctx.reply('Введите цену в сумах, только число:');
  }

  if (isAdmin(ctx) && ctx.session.step === 'product_price') {
    if (!/^\d+$/.test(ctx.message.text)) {
      return ctx.reply('Цена должна быть числом, например: 145000');
    }
    ctx.session.newProduct.price = Number(ctx.message.text);
    ctx.session.step = 'product_photo';
    return ctx.reply('Теперь отправьте фото товара:');
  }

  if (isAdmin(ctx) && ctx.session.step === 'broadcast_text') {
    const db = loadDb();
    let sent = 0;
    for (const userId of db.users) {
      try {
        await bot.api.sendMessage(userId, ctx.message.text);
        sent++;
      } catch (e) {}
    }
    ctx.session.step = null;
    return ctx.reply(`Рассылка завершена. Отправлено: ${sent}`);
  }

  if (openai) {
    try {
      const knowledge = loadKnowledge();
      const kb = ctx.session.lang === 'uz' ? knowledge.uz : knowledge.ru;
      const prompt = `
Ты продавец-консультант магазина подростковой одежды.
Отвечай коротко, вежливо, понятно.
Язык ответа: ${ctx.session.lang === 'uz' ? 'узбекский' : 'русский'}.
Если нужно связаться с продавцом — рекомендуй кнопку связи.
База знаний:
${kb.map(item => `Q: ${item.q}\nA: ${item.a}`).join('\n\n')}

Вопрос клиента:
${ctx.message.text}
      `;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }]
      });

      const answer = response.choices?.[0]?.message?.content || (
        ctx.session.lang === 'uz'
          ? "Kechirasiz, hozir javob bera olmadim."
          : 'Извините, сейчас не смог ответить.'
      );

      return ctx.reply(answer);
    } catch (e) {
      return ctx.reply(
        ctx.session.lang === 'uz'
          ? "Savolni menejerga yuboring."
          : 'Пожалуйста, уточните вопрос у менеджера.',
        { reply_markup: contactInline(ctx.session.lang) }
      );
    }
  }

  return ctx.reply(
    ctx.session.lang === 'uz'
      ? "Savol bo'lsa menejer bilan bog'laning."
      : 'Если есть вопрос, свяжитесь с менеджером.',
    { reply_markup: contactInline(ctx.session.lang) }
  );
});

bot.on('message:photo', async (ctx) => {
  if (!isAdmin(ctx) || ctx.session.step !== 'product_photo') return;

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const db = loadDb();
  const product = {
    id: Date.now(),
    category: ctx.session.newProduct.category,
    name: ctx.session.newProduct.name,
    description: ctx.session.newProduct.description,
    price: ctx.session.newProduct.price,
    photoFileId: photo.file_id,
    createdAt: new Date().toISOString()
  };

  db.products.push(product);
  saveDb(db);

  ctx.session.step = null;
  ctx.session.newProduct = {};

  await ctx.reply('✅ Товар успешно добавлен!', { reply_markup: adminMenu() });
});

async function runDailyBroadcast() {
  const db = loadDb();
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (hours !== DAILY_BROADCAST_HOUR || minutes !== DAILY_BROADCAST_MINUTE) return;

  if (!global.lastBroadcastDate) global.lastBroadcastDate = '';
  const today = now.toISOString().slice(0, 10);
  if (global.lastBroadcastDate === today) return;

  global.lastBroadcastDate = today;

  for (const userId of db.users) {
    try {
      await bot.api.sendMessage(userId, db.settings.dailyBroadcastTextRu);
    } catch (e) {}
  }
}

app.use('/webhook', webhookCallback(bot, 'express'));

app.get('/', (req, res) => {
  res.send('Consultant Bot is running');
});

app.listen(PORT, async () => {
  console.log(`Server started on port ${PORT}`);

  if (WEBHOOK_URL) {
    await bot.api.setWebhook(`${WEBHOOK_URL}/webhook`);
    console.log(`Webhook set: ${WEBHOOK_URL}/webhook`);
  }

  setInterval(() => {
    runDailyBroadcast().catch(console.error);
  }, 60 * 1000);
});
