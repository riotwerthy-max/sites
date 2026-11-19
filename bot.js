// ============================================================
//  SITE-MAKER BOT v7 PREMIUM PRO 🎄
//  Новое в v7:
//   • 🎁 Пробный премиум 24 часа каждому новичку
//   • 📸 Свои фото в сайте (премиум)
//   • 📲 QR-код сайта для печати (премиум)
//   • 👀 Счётчик посетителей на сайте (премиум)
//   • 📅 Кнопка «Записаться» с автосообщением (премиум)
//   • ✏️ Правки: бесплатно 1, премиум — без лимита
//   • 🛒 Продажа в момент радости + промокод NEWYEAR -30%
//   • 📈 /stats — статистика (только админ)
//  Запуск: node bot.js   |   Зависимости: npm install grammy qrcode
// ============================================================
const { Bot, InputFile, InlineKeyboard } = require('grammy');
const fs = require('fs');
const path = require('path');
const http = require('http');
const QRCode = require('qrcode');
const config = require('./config');

const bot = new Bot(config.TG_TOKEN);
const ADMIN_ID = config.ADMIN_ID || 0;
const PREMIUM_PRICE = config.PREMIUM_PRICE || 30;
const PROMO_PRICE = Math.max(1, Math.round(PREMIUM_PRICE * 0.7));
const TRIAL_MS = 24 * 60 * 60 * 1000;

// ---------- ХРАНИЛИЩЕ ----------
const P = (f) => path.join(__dirname, f);
const load = (f, def) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf8')); } catch { return def; } };
const save = (f, d) => { try { fs.writeFileSync(P(f), JSON.stringify(d, null, 2)); } catch (e) { console.log('save ' + f + ': ' + e.message); } };

let premium   = load('premium.json', {});
let stats     = load('stats.json', { sites: 0, users: 0, buys: 0 });
let mySites   = load('mysites.json', {});
let users     = load('users.json', {});
let promoUsed = load('promo.json', {});
const sessions = new Map();

function isPremium(id) {
  const p = premium[id];
  if (!p) return false;
  if (typeof p === 'object' && p.until) return new Date(p.until) > new Date();
  return true;
}
function isTrial(id) { return typeof premium[id] === 'object'; }

for (const id of Object.keys(mySites)) {
  mySites[id] = (mySites[id] || []).map((e) => (typeof e === 'string' ? { file: e, cat: 'visitka', data: {} } : e));
}

// ---------- УТИЛИТЫ ----------
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rnd = () => Math.random().toString(36).slice(2, 8);
const slug = (s) => ((String(s).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '')).slice(0, 14) || 'site') + '-' + rnd();
const owner = () => (config.GITHUB_REPO || '').split('/')[0];
const siteLink = (f) => 'https://' + owner() + '.github.io/sites/' + f;
const photoLink = (f) => 'https://' + owner() + '.github.io/photos/' + f;

function linkify(c) {
  c = String(c || '').trim();
  if (/^https?:\/\//i.test(c)) return esc(c);
  if (/^@/.test(c)) return 'https://t.me/' + c.slice(1);
  if (/^\+?\d{7,}$/.test(c)) return 'tel:' + c.replace(/[^\d+]/g, '');
  return 'https://t.me/' + (config.BOT_USERNAME || 'sitemaket_bot');
}
function bookingLink(c) {
  const l = linkify(c);
  return /^https:\/\/t\.me\//.test(l) ? l + '?text=' + encodeURIComponent('Здравствуйте! Хочу записаться 📅') : l;
}

// ---------- КАТЕГОРИИ ----------
const CATS = {
  visitka: { icon: '💼', name: 'Визитка и услуги',      g1: '#00c6ff', g2: '#7b2ff7', accent: '#00e5ff' },
  shop:    { icon: '🛒', name: 'Магазин',              g1: '#ff9966', g2: '#ff5e62', accent: '#ff8c42' },
  mc:      { icon: '🎮', name: 'Minecraft сервер',     g1: '#56ab2f', g2: '#a8e063', accent: '#7CFC00' },
  salon:   { icon: '💇', name: 'Салон / барбершоп',    g1: '#f953c6', g2: '#b91d73', accent: '#ff6ec7' },
  food:    { icon: '🍕', name: 'Доставка еды',         g1: '#f7971e', g2: '#ffd200', accent: '#ffb347' },
  photo:   { icon: '📸', name: 'Портфолио',            g1: '#8e2de2', g2: '#4a00e0', accent: '#c471ed' },
  event:   { icon: '🎉', name: 'Мероприятия',           g1: '#ee0979', g2: '#ff6a00', accent: '#ff4e9b' },
  sport:   { icon: '🏆', name: 'Турниры / киберспорт', g1: '#00b09b', g2: '#96c93d', accent: '#2dd4bf' },
};
const catKeyboard = () => ({ inline_keyboard: Object.entries(CATS).map(([k, c]) => [{ text: c.icon + ' ' + c.name, callback_data: 'cat:' + k }]) });

const MAIN_KB = { reply_markup: { keyboard: [
  [{ text: '🌐 Создать сайт' }],
  [{ text: '⭐ Премиум' }, { text: '📊 Мои сайты' }],
  [{ text: '✏️ Изменить сайт' }, { text: 'ℹ️ Помощь' }],
], resize_keyboard: true } };

const buyKb = () => new InlineKeyboard()
  .text('⭐ Купить за ' + PREMIUM_PRICE + ' ⭐', 'buy:full').row()
  .text('🎁 NEWYEAR -30% → ' + PROMO_PRICE + ' ⭐', 'buy:promo');

// ---------- ГЕНЕРАТОР САЙТА ----------
function parseServices(raw, catKey) {
  const defaults = {
    visitka: 'Консультация, Выполнение работы, Сопровождение',
    shop: 'Хиты продаж, Новинки, Со скидкой',
    mc: 'Выживание, Мини-игры, Ивенты каждую неделю',
    salon: 'Стрижка, Окрашивание, Укладка',
    food: 'Комбо-наборы, Горячее, Десерты',
    photo: 'Фотосессии, Обработка, Печать',
    event: 'Организация, Программа, Фотоотчёт',
    sport: 'Регистрация, Расписание, Призовой фонд',
  };
  const list = String(raw || '').trim() === '-' ? defaults[catKey] : raw;
  return String(list || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function buildHTML(d, catKey, prem) {
  const c = CATS[catKey] || CATS.visitka;
  const svcs = parseServices(d.services, catKey).map((s) => '<li>' + esc(s) + '</li>').join('');
  const photos = (prem && d.photos && d.photos.length)
    ? d.photos.map((u) => '<div class="ph"><img src="' + esc(u) + '" alt=""></div>').join('')
    : '';
  const counter = prem ? '<div class="views">👀 Нас уже посетили: <b id="vc">…</b></div>' : '';
  const book = prem
    ? '<a class="btn" target="_blank" href="' + bookingLink(d.contact) + '">📅 Записаться</a>'
    : '<a class="btn" target="_blank" href="' + linkify(d.contact) + '">Связаться</a>';
  const wm = prem ? '' : '<div class="wm">Сделано за 1 минуту в <a href="https://t.me/' + (config.BOT_USERNAME || 'sitemaket_bot') + '">@' + (config.BOT_USERNAME || 'sitemaket_bot') + '</a> — сделай свой сайт</div>';
  const badge = prem ? (isTrialForever(prem) ? '⭐ PREMIUM' : '⭐ PREMIUM TRIAL') : c.icon + ' ' + c.name;
  const faq = [
    ['Сколько стоит?', 'У каждого проекта свой объём, но мы всегда честны: озвучиваем итог до старта, без скрытых доплат.'],
    ['Как быстро?', 'Большинство задач делаем за 1–3 дня. Точный срок называем сразу.'],
    ['Есть ли гарантия?', 'Да. Если что-то не так — переделаем или вернём деньги.'],
  ];
  const reviews = (prem && d.reviews && d.reviews.length)
    ? d.reviews
    : [['Алексей', 'Обратился поздно вечером — ответили сразу, всё сделали быстро и качественно. Рекомендую!'], ['Мария', 'Приятное общение, честные цены и отличный результат. Вернусь ещё 👌'], ['Дмитрий', 'Всё чётко и по делу. Ни одного лишнего вопроса, всё сделали как обещали.']];

  return '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(d.name) + '</title>' +
    '<script>let n=localStorage.getItem("vc")||0;n++;localStorage.setItem("vc",n);addEventListener("load",function(){var el=document.getElementById("vc");if(el)el.textContent=n})</script>' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;background:#0b0a1a;color:#fff;overflow-x:hidden}' +
    '.hero{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px 20px 40px;background:linear-gradient(135deg,' + c.g1 + ',' + c.g2 + ')}' +
    '.hero h1{font-size:clamp(28px,7vw,54px);margin-bottom:10px;text-shadow:0 4px 20px rgba(0,0,0,.4)}' +
    '.hero p{opacity:.9;max-width:600px}.badge{display:inline-block;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.35);border-radius:30px;padding:6px 16px;margin-bottom:18px;font-size:13px;font-weight:bold;letter-spacing:1px}' +
    '.wrap{max-width:900px;margin:0 auto;padding:40px 20px}.sec{opacity:0;transform:translateY(24px);transition:all .7s}.sec.on{opacity:1;transform:none}' +
    'h2{font-size:26px;margin-bottom:18px;color:' + c.accent + ';text-align:center}' +
    '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}' +
    '.card{background:#151431;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px;transition:transform .25s}.card:hover{transform:translateY(-6px)}' +
    '.card li{margin:8px 0;list-style:none}.card li::before{content:"✔ ";color:' + c.accent + '}' +
    '.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:24px}.ph img{width:100%;border-radius:12px;display:block}' +
    '.rev{background:#151431;border-radius:16px;padding:18px;margin:10px 0}.rev b{color:' + c.accent + '}' +
    '.btn{display:inline-block;background:linear-gradient(135deg,' + c.g1 + ',' + c.g2 + ');color:#fff;text-decoration:none;padding:14px 34px;border-radius:40px;font-weight:bold;margin:10px 5px 0 0;box-shadow:0 6px 24px rgba(0,0,0,.4)}' +
    '.views{text-align:center;margin:30px 0 6px;font-size:15px;opacity:.95}' +
    '.wm{text-align:center;opacity:.6;font-size:13px;padding:30px 20px}.wm a{color:#8ef}' +
    'footer{background:#07060f;padding:36px 20px;text-align:center;font-size:14px;opacity:.9}' +
    '</style></head><body>' +
    '<div class="hero"><div class="badge">' + badge + '</div><h1>' + esc(d.name) + '</h1><p>' + esc(d.subtitle) + '</p>' + book + '</div>' +
    '<div class="wrap">' +
    '<div class="sec"><h2>💼 Услуги</h2><div class="cards"><div class="card"><ul>' + svcs + '</ul></div></div></div>' +
    (photos ? '<div class="sec"><h2>📸 Фотогалерея</h2><div class="gallery">' + photos + '</div></div>' : '') +
    '<div class="sec"><h2>💬 Отзывы</h2>' + reviews.map((r) => '<div class="rev"><b>' + esc(r[0]) + ':</b> «' + esc(r[1]) + '»</div>').join('') + '</div>' +
    '<div class="sec"><h2>❓ Вопросы</h2>' + faq.map((f) => '<div class="rev"><b>' + esc(f[0]) + '</b><br>' + esc(f[1]) + '</div>').join('') + '</div>' +
    '<div class="sec"><h2>📞 Контакты</h2><div style="text-align:center">' + esc(d.contact) + '<br>' + book + '</div></div>' +
    counter +
    '</div>' + wm +
    '<footer>© ' + new Date().getFullYear() + ' ' + esc(d.name) + ' · Работаем для вас ❤️</footer>' +
    '<script>document.querySelectorAll(".sec").forEach(function(s){var io=new IntersectionObserver(function(en){en.forEach(function(e){if(e.isIntersecting)e.target.classList.add("on")})});io.observe(s)})</script>' +
    '</body></html>';
}
function isTrialForever() { return true; } // бейдж для купивших

// ---------- GITHUB PAGES ----------
async function publish(file, html) {
  const url = 'https://api.github.com/repos/' + config.GITHUB_REPO + '/contents/sites/' + encodeURIComponent(file);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + config.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'site-bot' },
    body: JSON.stringify({ message: 'site: ' + file, content: Buffer.from(html, 'utf8').toString('base64') }),
  });
  if (!res.ok) throw new Error('GitHub ' + res.status);
}

async function publishPhoto(fname, buf) {
  const url = 'https://api.github.com/repos/' + config.GITHUB_REPO + '/contents/photos/' + encodeURIComponent(fname);
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + config.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'site-bot' },
    body: JSON.stringify({ message: 'photo: ' + fname, content: buf.toString('base64') }),
  });
  if (!res.ok) throw new Error('GitHub ' + res.status);
}

// ---------- ДИАЛОГ СОЗДАНИЯ ----------
async function askStep(ctx, s) {
  if (s.step === 0) return ctx.reply('1/5 Как называется ваш проект?\nНапример: Барбершоп «Волк»');
  if (s.step === 1) return ctx.reply('2/5 Кратко опишите, чем вы занимаетесь (1–2 предложения):');
  if (s.step === 2) return ctx.reply('3/5 Перечислите услуги или товары через запятую.\nМожно с ценами: Стрижка - 500р, Борода - 300р.\nИли отправьте «-» — подставим типовые.');
  if (s.step === 3) return ctx.reply('4/5 Контакт для связи: @юзернейм, телефон или ссылка');
  if (s.step === 4) {
    if (isPremium(ctx.from.id)) {
      if (!s.askedPhoto) { s.askedPhoto = true; return ctx.reply('⭐ 5/5 Хотите свои фото на сайте?\nПришлите 1–3 фото, или «-» чтобы пропустить.'); }
    } else { s.step = 5; return finishSite(ctx, s); }
  }
  if (s.step === 5) {
    if (isPremium(ctx.from.id) && !s.askedRev) {
      s.askedRev = true;
      return ctx.reply('⭐ Премиум-шаг: добавим отзывы клиентов?\nФормат: Имя = отзыв (до 3 штук, по одному сообщению). Или «-».');
    }
  }
  return finishSite(ctx, s);
}

async function finishSite(ctx, s) {
  const d = s.data;
  const catKey = s.cat;
  const prem = isPremium(ctx.from.id);
  sessions.delete(ctx.from.id);
  const msg = await ctx.reply('🛠 Собираю каркас…');
  await ctx.api.editMessageText(msg.chat.id, msg.message_id, '🎨 Наношу дизайн…');
  const html = buildHTML(d, catKey, prem);
  const file = slug(d.name) + '.html';
  if (!config.GITHUB_TOKEN || !config.GITHUB_REPO) {
    await ctx.reply('⚠️ GITHUB_TOKEN не настроен — отправляю сайт файлом:');
    return ctx.replyWithDocument(new InputFile(Buffer.from(html, 'utf8'), file));
  }
  await ctx.api.editMessageText(msg.chat.id, msg.message_id, '🚀 Публикую…');
  try {
    await publish(file, html);
  } catch (e) {
    await ctx.reply('⚠️ Не удалось опубликовать: ' + e.message + '\nОтправляю файлом:');
    return ctx.replyWithDocument(new InputFile(Buffer.from(html, 'utf8'), file));
  }
  stats.sites++; save('stats.json', stats);
  (mySites[ctx.from.id] = mySites[ctx.from.id] || []).push({ file, cat: catKey, data: d });
  save('mysites.json', mySites);
  const link = siteLink(file);
  await ctx.api.editMessageText(msg.chat.id, msg.message_id, '🎉 Готово! Ваш сайт:');
  await ctx.reply(link);

  if (prem) {
    try {
      const buf = await QRCode.toBuffer(link, { width: 400, margin: 2, color: { dark: '#0b0a1a', light: '#ffffff' } });
      await ctx.replyWithPhoto(new InputFile(buf, 'qr.png'), { caption: '📲 Ваш QR-код — распечатайте и повесьте на видное место!' });
    } catch (e) { console.log('QR err ' + e.message); }
  }

  if (!prem) {
    const upsell = new InlineKeyboard()
      .text('⭐ Открыть премиум за ' + PREMIUM_PRICE + ' ⭐', 'buy:full').row()
      .text('🎁 NEWYEAR -30% → ' + PROMO_PRICE + ' ⭐', 'buy:promo').row()
      .text('Не сейчас', 'upsell:no');
    await ctx.reply(
      '✨ Сайт готов! Хотите его в 2 раза мощнее?\n\n' +
      '⭐ ПРЕМИУМ даёт: 📸 свои фото · 📲 QR-код для печати · 👀 счётчик посетителей · ' +
      '📅 кнопку «Записаться» · ✏️ правки без лимита · 🚫 без водяного знака.\n\n' +
      '⭐ ' + PREMIUM_PRICE + ' — навсегда. Промокод NEWYEAR: ' + PROMO_PRICE + ' ⭐', { reply_markup: upsell });
  }
}

// ---------- ФОТО (премиум, шаг 5) ----------
bot.on('message:photo', async (ctx) => {
  const s = sessions.get(ctx.from.id);
  if (!s || s.step !== 4 || !isPremium(ctx.from.id)) return;
  if (s.data.photos && s.data.photos.length >= 3) return ctx.reply('Хватит 3 фото 😊');
  try {
    const f = await ctx.getFile();
    const u = 'https://api.telegram.org/file/bot' + config.TG_TOKEN + '/' + f.file_path;
    const res = await fetch(u);
    const buf = Buffer.from(await res.arrayBuffer());
    const fname = slug('photo') + '.jpg';
    await publishPhoto(fname, buf);
    (s.data.photos = s.data.photos || []).push(photoLink(fname));
    ctx.reply('✅ Фото добавлено! Ещё фото или «-».');
  } catch (e) { ctx.reply('⚠️ Не удалось загрузить фото: ' + e.message); }
});

// ---------- ОПЛАТА (Stars/XTR) ----------
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));
bot.on('message:successful_payment', (ctx) => {
  const id = ctx.from.id;
  premium[id] = 'forever'; save('premium.json', premium);
  stats.buys++; save('stats.json', stats);
  sessions.delete(id);
  if (ADMIN_ID) bot.api.sendMessage(ADMIN_ID, '💰 ' + (ctx.from.first_name || 'Кто-то') + ' купил ПРЕМИУМ! Всего покупок: ' + stats.buys).catch(() => {});
  ctx.reply('🎉 ПРЕМИУМ АКТИВИРОВАН!\n\nТеперь: 📸 свои фото · 📲 QR-код · 👀 счётчик посетителей · 📅 «Записаться» · ✏️ правки без лимита · 🚫 без водяного знака.\n\nСоздайте сайт заново (🌐 Создать сайт) — он соберётся в премиум-версии!', MAIN_KB);
});

// ---------- CALLBACK-КНОПКИ ----------
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery().catch(() => {});
  if (data.startsWith('cat:')) {
    sessions.set(ctx.from.id, { cat: data.slice(4), step: 0, data: {} });
    return askStep(ctx, sessions.get(ctx.from.id));
  }
  if (data === 'buy:full' || data === 'buy:promo') {
    if (data === 'buy:promo' && promoUsed[ctx.from.id]) return ctx.reply('🎁 Промокод NEWYEAR уже использован вами 😉');
    const amount = data === 'buy:promo' ? PROMO_PRICE : PREMIUM_PRICE;
    try {
      await ctx.replyWithInvoice({
        title: '⭐ Премиум навсегда',
        description: 'Свои фото, QR-код, счётчик посетителей, «Записаться», правки без лимита, без водяного знака',
        payload: 'prem-' + ctx.from.id + '-' + amount,
        currency: 'XTR',
        prices: [{ label: 'Премиум навсегда', amount: amount }],
      });
    } catch (e) { ctx.reply('⚠️ Ошибка оплаты: ' + e.message); }
    return;
  }
  if (data === 'upsell:no') return ctx.reply('Хорошо! Премиум всегда ждёт по кнопке ⭐ Премиум 😉');
  if (data === 'start:site') return ctx.reply('Выберите категорию сайта:', { reply_markup: catKeyboard() });
  if (data === 'start:prem') {
    return ctx.reply('⭐ ПРЕМИУМ:\n\n📸 свои фото\n📲 QR-код для печати\n👀 счётчик посетителей\n📅 кнопка «Записаться»\n✏️ правки без лимита\n🚫 без водяного знака\n\n' + PREMIUM_PRICE + ' ⭐ навсегда · промокод NEWYEAR: ' + PROMO_PRICE + ' ⭐', { reply_markup: buyKb() });
  }
  if (data === 'start:help') {
    return ctx.reply('ℹ️ Как это работает:\n\n1. Выбираете категорию\n2. Отвечаете на 4–5 вопросов (1 минута)\n3. Бот собирает сайт и публикует на GitHub Pages\n4. Ссылку отправляете клиентам — они видят красивый сайт\n\nПравки: ✏️ Изменить сайт (премиум — без лимита).');
  }
});

// ---------- ТЕКСТОВЫЕ СООБЩЕНИЯ И КОМАНДЫ ----------
bot.on('message:text', async (ctx) => {
  const id = ctx.from.id;
  const t = ctx.message.text;

  // новый пользователь → пробный премиум 24 ч + уведомление админу
  if (!users[id]) {
    users[id] = { name: ctx.from.first_name, date: new Date().toISOString() };
    save('users.json', users);
    stats.users++; save('stats.json', stats);
    if (!premium[id]) {
      premium[id] = { until: new Date(Date.now() + TRIAL_MS).toISOString() };
      save('premium.json', premium);
      if (ADMIN_ID) {
        bot.api.sendMessage(ADMIN_ID, '👤 Новый пользователь: ' + (ctx.from.first_name || '') + ' (id ' + id + ')\n👥 Всего: ' + Object.keys(users).length + ' · 🌐 Сайтов: ' + stats.sites).catch(() => {});
      }
    }
  }

  if (t === '/start') {
    sessions.delete(id);
    const trialLeft = isTrial(id) ? Math.max(1, Math.round((new Date(premium[id].until) - Date.now()) / 3600000)) : 0;
    const kb = new InlineKeyboard()
      .text('🚀 Создать сайт сейчас', 'start:site').row()
      .text('⭐ Смотреть премиум', 'start:prem').row()
      .text('ℹ️ Как это работает', 'start:help');
    return ctx.reply(
      '🎄 Привет, ' + (ctx.from.first_name || 'друг') + '!\n\n' +
      'Я — <b>Site-Maker</b> 🌐\n' +
      'Создаю <b>красивые сайты за 1 минуту</b>: отвечаешь на 4 вопроса — получаешь готовый сайт со ссылкой для клиентов.\n\n' +
      (trialLeft ? '🎁 <b>Тебе подарен ПРОБНЫЙ ПРЕМИУМ на ' + trialLeft + ' ч!</b>\nСвои фото, QR-код, счётчик посетителей, кнопка «Записаться» — уже доступны!\n\n' : '') +
      'Что тебе нужно?\n👇',
      { parse_mode: 'HTML', reply_markup: kb });
  }

  if (t === '/cancel') { sessions.delete(id); return ctx.reply('❌ Отменено.', MAIN_KB); }

  if (t === '/stats') {
    if (id !== ADMIN_ID) return ctx.reply('📊 Статистика доступна только администратору.');
    const totalUsers = Object.keys(users).length;
    const forever = Object.entries(premium).filter(([k, v]) => v === 'forever').length;
    const trialActive = Object.entries(premium).filter(([k, v]) => typeof v === 'object' && new Date(v.until) > new Date()).length;
    const today = Object.values(users).filter((u) => u.date && new Date(u.date) > new Date(Date.now() - 86400000)).length;
    return ctx.reply(
      '📊 <b>СТАТИСТИКА БОТА</b>\n\n' +
      '👥 Всего пользователей: <b>' + totalUsers + '</b>\n' +
      '🔥 Новых за 24 часа: <b>' + today + '</b>\n' +
      '🌐 Сайтов создано: <b>' + (stats.sites || 0) + '</b>\n' +
      '💰 Премиум-покупок: <b>' + (stats.buys || 0) + '</b>\n' +
      '⭐ Премиум навсегда: <b>' + forever + '</b>\n' +
      '🎁 Активных пробных: <b>' + trialActive + '</b>',
      { parse_mode: 'HTML' });
  }

  if (t === '🌐 Создать сайт') return ctx.reply('Выберите категорию сайта:', { reply_markup: catKeyboard() });

  if (t === '⭐ Премиум') {
    if (isPremium(id)) {
      return ctx.reply('⭐ У вас ' + (isTrial(id) ? 'ПРОБНЫЙ премиум (24 ч от первой активации)' : 'ПРЕМИУМ навсегда') + '!\n\n' +
        'Доступно: 📸 фото · 📲 QR · 👀 счётчик · 📅 «Записаться» · ✏️ правки без лимита · 🚫 без водяного знака' +
        (isTrial(id) ? '\n\n⏳ После триала — ' + PREMIUM_PRICE + ' ⭐ навсегда. Промокод NEWYEAR: ' + PROMO_PRICE + ' ⭐!' : ''), MAIN_KB);
    }
    return ctx.reply(
      '⭐ <b>ПРЕМИУМ</b> — максимум возможностей:\n\n' +
      '📸 Свои фото на сайте\n' +
      '📲 QR-код для печати (касса, визитки)\n' +
      '👀 Счётчик посетителей — виден эффект\n' +
      '📅 Кнопка «Записаться» с автосообщением\n' +
      '✏️ Правки без лимита\n' +
      '🚫 Без водяного знака\n\n' +
      'Цена: <b>' + PREMIUM_PRICE + ' ⭐ навсегда</b>\n' +
      '🎁 Промокод <b>NEWYEAR</b>: -30% → <b>' + PROMO_PRICE + ' ⭐</b>\n\n' +
      '⭐ ' + PREMIUM_PRICE + ' — чашка кофе, а сайт навсегда ☕',
      { parse_mode: 'HTML', reply_markup: buyKb() });
  }

  if (t === '📊 Мои сайты') {
    const arr = mySites[id] || [];
    if (!arr.length) return ctx.reply('Пока нет созданных сайтов. Жмите «🌐 Создать сайт»!', MAIN_KB);
    return ctx.reply('📊 Ваши сайты (последние 10):\n\n' +
      arr.slice(-10).reverse().map((e) => '• <a href="' + siteLink(e.file) + '">' + esc(e.data && e.data.name ? e.data.name : e.file) + '</a>').join('\n'),
      { parse_mode: 'HTML' });
  }

  if (t === '✏️ Изменить сайт' || t === '/edit') {
    const arr = mySites[id] || [];
    if (!arr.length) return ctx.reply('Сначала создайте сайт 🌐');
    if (!isPremium(id)) {
      users[id].edits = (users[id].edits || 0) + 1;
      if (users[id].edits > 1) {
        return ctx.reply('✏️ Бесплатно — 1 правка. Дальше — ⭐ ПРЕМИУМ с правками без лимита!\n\n' + PREMIUM_PRICE + ' ⭐ навсегда · промокод NEWYEAR: ' + PROMO_PRICE + ' ⭐', { reply_markup: buyKb() });
      }
    }
    const last = arr[arr.length - 1];
    sessions.set(id, { cat: last.cat, step: 0, data: {} });
    return ctx.reply('✏️ Пересоздадим ваш сайт — отвечайте на вопросы:\n1/5 Название проекта:');
  }

  if (t === 'ℹ️ Помощь' || t === '/help') {
    return ctx.reply(
      'ℹ️ <b>Site-Maker — как это работает</b>\n\n' +
      '🌐 <b>Создать сайт</b> → категория → 4–5 вопросов → готовая ссылка за 1 минуту\n' +
      '⭐ <b>Премиум</b>: 📸 свои фото · 📲 QR-код · 👀 счётчик · 📅 «Записаться» · ✏️ правки без лимита · 🚫 без водяного знака\n' +
      '📊 <b>Мои сайты</b> — список ваших ссылок\n' +
      '✏️ <b>Изменить сайт</b> — пересоздать (премиум — без лимита)\n\n' +
      'Команды: /start · /help · /cancel' + (id === ADMIN_ID ? ' · /stats' : '') + '\n' +
      '🎄 Сделано в @sitemaket_bot', { parse_mode: 'HTML' });
  }

  // ---------- диалог создания ----------
  const s = sessions.get(id);
  if (!s) return ctx.reply('Используйте кнопки меню 👇', MAIN_KB);
  const d = s.data;
  if (s.step === 0) { d.name = t; s.step = 1; return askStep(ctx, s); }
  if (s.step === 1) { d.subtitle = t; s.step = 2; return askStep(ctx, s); }
  if (s.step === 2) { d.services = t; s.step = 3; return askStep(ctx, s); }
  if (s.step === 3) { d.contact = t; s.step = 4; return askStep(ctx, s); }
  if (s.step === 4) {
    if (!isPremium(id)) { s.step = 5; return finishSite(ctx, s); }
    if (t === '-') { s.step = 5; return askStep(ctx, s); }
    return ctx.reply('⭐ Пришлите фото (до 3) или «-» чтобы пропустить.');
  }
  if (s.step === 5) {
    if (!isPremium(id)) return finishSite(ctx, s);
    if (!s.askedRev) { s.askedRev = true; return ctx.reply('⭐ Добавим отзывы клиентов?\nФормат: Имя = отзыв (до 3). Или «-».'); }
    if (t === '-') return finishSite(ctx, s);
    const i = t.indexOf('=');
    if (i < 1) return ctx.reply('⚠️ Формат: Имя = отзыв. Или «-».');
    (d.reviews = d.reviews || []).push([t.slice(0, i).trim().slice(0, 40), t.slice(i + 1).trim().slice(0, 300)]);
    if (d.reviews.length >= 3) return finishSite(ctx, s);
    return ctx.reply('✅ Принято! Ещё отзыв или «-».');
  }
  return ctx.reply('Используйте кнопки меню 👇', MAIN_KB);
});

// ---------- ВЕБ-СЕРВЕР ДЛЯ RENDER ----------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Site-Maker bot v7 PREMIUM PRO работает 🎄');
}).listen(PORT, () => console.log('Порт ' + PORT + ' ОК'));

// ---------- ЗАЩИТА + ЗАПУСК ----------
bot.catch((err) => {
  const msg = err && err.error && err.error.message ? err.error.message : String(err);
  console.log('⚠️ Ошибка (не критично): ' + msg);
});
if (ADMIN_ID) bot.api.sendMessage(ADMIN_ID, '🚀 Site-Maker v7 PREMIUM PRO запущен! Новое: пробный премиум 24ч, фото, QR, счётчик, NEWYEAR -30%, /stats.').catch(() => {});
bot.start();
console.log('🎄 v7 PREMIUM PRO запущен');
