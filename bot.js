// ============================================================
//  SITE-MAKER BOT v6 PREMIUM+ 🎄
//  grammy 1.46 | Stars/XTR | 8 категорий | /edit /delete | темы | фото | свои отзывы
//  Запуск: node bot.js
// ============================================================
const { Bot } = require("grammy");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const bot = new Bot(config.TG_TOKEN);

// ---------- ХРАНИЛИЩЕ ----------
const P = (f) => path.join(__dirname, f);
const load = (f, def) => { try { return JSON.parse(fs.readFileSync(P(f), "utf8")); } catch { return def; } };
const save = (f, d) => { try { fs.writeFileSync(P(f), JSON.stringify(d, null, 2)); } catch (e) { console.log("save " + f + ": " + e.message); } };

let premium = load("premium.json", {});
let stats   = load("stats.json", { sites: 0 });
let mySites = load("mysites.json", {});
let users   = load("users.json", {});
const sessions = new Map();

const isPremium = (id) => !!premium[id];

// миграция старого формата (строки -> объекты, чтобы работал /edit)
for (const id of Object.keys(mySites)) {
  mySites[id] = (mySites[id] || []).map((e) =>
    typeof e === "string" ? { file: e, cat: "visitka", data: {} } : e
  );
}

// ---------- УТИЛИТЫ ----------
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rnd = () => Math.random().toString(36).slice(2, 8);
const slug = (s) =>
  ((String(s).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "")).slice(0, 14) || "site") + "-" + rnd();
const owner = () => (config.GITHUB_REPO || "").split("/")[0];
const siteLink = (f) => "https://" + owner() + ".github.io/sites/" + f;

function linkify(c) {
  c = String(c || "").trim();
  if (/^https?:\/\//i.test(c)) return esc(c);
  if (/^@/.test(c)) return "https://t.me/" + c.slice(1);
  if (/^\+?\d{7,}$/.test(c)) return "tel:" + c.replace(/[^\d+]/g, "");
  return "https://t.me/" + (config.BOT_USERNAME || "sitemaket_bot");
}

// ---------- КАТЕГОРИИ ----------
const CATS = {
  visitka: { icon: "💼", name: "Визитка и услуги",      g1: "#00c6ff", g2: "#7b2ff7", accent: "#00e5ff" },
  shop:    { icon: "🛒", name: "Магазин",              g1: "#ff9966", g2: "#ff5e62", accent: "#ff8c42" },
  mc:      { icon: "🎮", name: "Minecraft сервер",     g1: "#56ab2f", g2: "#a8e063", accent: "#7CFC00" },
  salon:   { icon: "💇", name: "Салон / барбершоп",    g1: "#f953c6", g2: "#b91d73", accent: "#ff6ec7" },
  food:    { icon: "🍕", name: "Доставка еды",          g1: "#f7971e", g2: "#ffd200", accent: "#ffb347" },
  photo:   { icon: "📸", name: "Портфолио",            g1: "#8e2de2", g2: "#4a00e0", accent: "#c471ed" },
  event:   { icon: "🎉", name: "Мероприятия",           g1: "#ee0979", g2: "#ff6a00", accent: "#ff4e9b" },
  sport:   { icon: "🏆", name: "Турниры / киберспорт", g1: "#00b09b", g2: "#96c93d", accent: "#2dd4bf" },
};

// ---------- ТЕМЫ ДИЗАЙНА (ПРЕМИУМ) ----------
const THEMES = {
  "1": { g1: "#3a7bd5", g2: "#00d2ff", accent: "#38bdf8" },
  "2": { g1: "#b06ab3", g2: "#f6416c", accent: "#ff4e9b" },
  "3": { g1: "#f7971e", g2: "#ffd200", accent: "#ffd700" },
  "4": { g1: "#0ba360", g2: "#3cba92", accent: "#34d399" },
};

const catKeyboard = () => ({
  inline_keyboard: Object.entries(CATS).map(([k, c]) => [{ text: c.icon + " " + c.name, callback_data: "cat:" + k }]),
});

// ---------- ГЕНЕРАТОР САЙТА ----------
function parseServices(raw, catKey) {
  const defaults = {
    visitka: "Консультация, Выполнение работы, Сопровождение",
    shop: "Хиты продаж, Новинки, Со скидкой",
    mc: "Выживание, Мини-игры, Ивенты каждую неделю",
    salon: "Стрижка, Окрашивание, Укладка",
    food: "Комбо-наборы, Горячее, Десерты",
    photo: "Фотосессии, Обработка, Печать",
    event: "Дни рождения, Корпоративы, Ведущий",
    sport: "Регистрация команды, Призовой фонд, Расписание матчей",
  };
  const parts = String(raw || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const list = parts.length ? parts : String(defaults[catKey]).split(",").map((s) => s.trim());
  return list.map((p) => {
    const m = p.split(/\s+[-–—]\s+/);
    return { name: m[0], price: m[1] || "" };
  });
}

function parseReviews(raw) {
  const def = [
    ["Алексей", "Обратился поздно вечером — ответили сразу, всё сделали быстро и качественно. Рекомендую!"],
    ["Мария", "Приятное общение, честные цены и отличный результат. Вернусь ещё 👌"],
    ["Дмитрий", "Всё чётко и по делу. Ни одного лишнего вопроса, всё сделали как обещали."],
  ];
  if (!raw) return def;
  const lines = String(raw).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const custom = lines.map((l) => {
    const m = l.split(/\s+[-–—]\s+/);
    return m[0] ? [m[0], m[1] || "Отличный сервис, рекомендую!"] : null;
  }).filter(Boolean);
  return custom.length ? custom : def;
}

function buildSite(catKey, d, prem, themeKey) {
  const c = Object.assign({}, CATS[catKey]);
  if (prem && themeKey && THEMES[themeKey]) Object.assign(c, THEMES[themeKey]);
  const contact = d.contact || "";
  const services = parseServices(d.services, catKey);
  const items = services.map((s, i) =>
    '<div class="card reveal"><div class="num">' + (i + 1) + '</div><h3>' + esc(s.name) + "</h3>" +
    (s.price ? '<div class="price">' + esc(s.price) + "</div>" : "") +
    '<p>Качественно, быстро и с вниманием к деталям. Пишите — обсудим детали и сроки.</p></div>'
  ).join("");

  const faq = [
    ["Как заказать?", "Просто нажмите кнопку ниже или напишите нам — ответим в течение нескольких минут."],
    ["Сколько это стоит?", "Цена зависит от объёма, но мы всегда честны: озвучиваем итог до старта, без скрытых доплат."],
    ["Есть ли гарантия?", "Да. Если что-то не так — переделаем или вернём деньги."],
  ].map((f) => '<div class="faq reveal"><b>' + esc(f[0]) + "</b><p>" + esc(f[1]) + "</p></div>").join("");

  const reviews = parseReviews(d.reviews).map((r) => '<div class="rev reveal"><b>' + esc(r[0]) + "</b><p>«" + esc(r[1]) + "»</p></div>").join("");

  const wm = prem ? "" :
    '<div class="wm">🎁 <a href="https://t.me/' + esc(config.BOT_USERNAME || "sitemaket_bot") + '">Сделано в @' + esc(config.BOT_USERNAME || "sitemaket_bot") + "</a></div>";

  const badge = prem ? '<div class="badge gold">⭐ PREMIUM</div>' : '<div class="badge">' + c.icon + " " + esc(c.name) + "</div>";

  const heroBg = (prem && d.photo && /^https?:\/\//i.test(d.photo))
    ? "background-image:url('" + esc(d.photo) + "');background-size:cover;background-position:center"
    : "";

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(d.name)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${c.icon}</text></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{font:16px/1.7 system-ui,Arial,sans-serif;background:linear-gradient(160deg,#0a0e1a 0%,#141a33 50%,#0a0e1a 100%);color:#e8eefc;min-height:100vh}
nav{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:12px;background:rgba(10,14,26,.75);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.08)}
nav a{color:#cfd8f0;text-decoration:none;font-size:.85rem;padding:7px 14px;border-radius:99px;border:1px solid rgba(255,255,255,.1);transition:.25s}
nav a:hover{color:${c.accent};border-color:${c.accent}}
.wrap{max-width:960px;margin:0 auto;padding:110px 20px 40px}
.hero{text-align:center;padding:60px 0 40px;border-radius:24px}
.hero h1{font-size:clamp(2rem,6vw,3.2rem);background:linear-gradient(90deg,${c.g1},${c.g2},${c.g1});-webkit-background-clip:text;background-clip:text;color:transparent;background-size:200% auto;animation:shine 4s linear infinite}
@keyframes shine{to{background-position:200% center}}
.hero .sub{color:#aab8dd;font-size:1.15rem;margin-top:14px}
.badge{display:inline-block;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.18);color:${c.accent};padding:7px 16px;border-radius:99px;font-size:.85rem;margin-bottom:22px}
.badge.gold{color:#ffd700;border-color:rgba(255,215,0,.5);box-shadow:0 0 20px rgba(255,215,0,.25)}
section{margin:70px 0;scroll-margin-top:80px}
h2{font-size:1.7rem;margin-bottom:24px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:28px;transition:.3s;backdrop-filter:blur(8px)}
.card:hover{transform:translateY(-6px);border-color:${c.accent};box-shadow:0 15px 40px rgba(0,0,0,.4)}
.card .num{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-weight:800;margin-bottom:14px;background:linear-gradient(135deg,${c.g1},${c.g2});color:#0a0e1a}
.card h3{margin-bottom:8px}
.price{color:${c.accent};font-weight:800;margin-bottom:8px}
.rev{background:rgba(255,255,255,.05);border-left:3px solid ${c.accent};border-radius:0 16px 16px 0;padding:20px 24px;margin:14px 0}
.faq{background:rgba(255,255,255,.05);border-radius:16px;padding:20px 24px;margin:12px 0}
.about{background:rgba(255,255,255,.05);border-radius:24px;padding:34px;border:1px solid rgba(255,255,255,.1);text-align:center;font-size:1.05rem}
a.btn{display:inline-block;background:linear-gradient(90deg,${c.g1},${c.g2});color:#0a0e1a;font-weight:800;padding:16px 38px;border-radius:99px;text-decoration:none;margin-top:24px;box-shadow:0 8px 28px rgba(0,0,0,.4);transition:.3s;font-size:1.05rem}
a.btn:hover{transform:scale(1.06)}
.reveal{opacity:0;transform:translateY(26px);transition:.7s cubic-bezier(.2,.7,.3,1)}
.reveal.show{opacity:1;transform:none}
footer.trust{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;padding:26px 10px;margin-top:60px;color:#93a2c8;font-size:.9rem;background:rgba(255,255,255,.03);border-top:1px solid rgba(255,255,255,.08)}
footer.trust div{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:8px 14px}
.wm{position:fixed;left:14px;bottom:14px;z-index:60;background:rgba(10,14,26,.85);border:1px solid rgba(255,255,255,.15);border-radius:99px;padding:8px 16px;font-size:.8rem;backdrop-filter:blur(8px)}
.wm a{color:${c.accent};text-decoration:none}
</style></head><body>
<nav>
  <a href="#about">О нас</a><a href="#services">Услуги</a><a href="#reviews">Отзывы</a><a href="#faq">Вопросы</a><a href="#contacts">Контакты</a>
</nav>
<div class="wrap">
  <div class="hero" style="${heroBg}">
    ${badge}
    <h1>${esc(d.name)}</h1>
    <div class="sub">${esc(d.subtitle)}</div>
    <a class="btn" href="${linkify(contact)}">${c.icon} Заказать сейчас</a>
  </div>
  <section id="about"><h2>✨ О нас</h2>
    <div class="about reveal">${esc(d.subtitle)}. Мы работаем быстро, честно и всегда на связи — включая выходные и праздники.</div>
  </section>
  <section id="services"><h2>${c.icon} Услуги</h2>
    <div class="grid">${items}</div>
  </section>
  <section id="reviews"><h2>💬 Отзывы</h2>${reviews}</section>
  <section id="faq"><h2>❓ Частые вопросы</h2>${faq}</section>
  <section id="contacts"><h2>📞 Контакты</h2>
    <div class="about reveal">
      Связаться с нами проще простого — жми кнопку, отвечаем быстро.
      <div style="margin-top:10px;color:${c.accent};font-weight:700">${esc(contact)}</div>
      <a class="btn" href="${linkify(contact)}">🎁 Написать</a>
    </div>
  </section>
</div>
${wm}
<footer class="trust">
  <div>🔒 Безопасная оплата</div><div>🛡 Защита данных</div><div>📞 Поддержка 24/7</div><div>✅ Гарантия качества</div>
</footer>
<script>
(function(){
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("show");io.unobserve(e.target)}})},{threshold:.12});
  document.querySelectorAll(".reveal").forEach(function(el){io.observe(el)});
})();
</script>
</body></html>`;
}

// ---------- GITHUB ----------
async function publish(file, html) {
  const url = "https://api.github.com/repos/" + config.GITHUB_REPO + "/contents/" + encodeURIComponent(file);
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: "Bearer " + config.GITHUB_TOKEN, Accept: "application/vnd.github+json", "User-Agent": "site-bot" },
    body: JSON.stringify({ message: "site: " + file, content: Buffer.from(html, "utf8").toString("base64") }),
  });
  if (!res.ok) throw new Error("GitHub " + res.status);
}

async function unpublish(file) {
  try {
    const auth = { Authorization: "Bearer " + config.GITHUB_TOKEN, Accept: "application/vnd.github+json" };
    const url = "https://api.github.com/repos/" + config.GITHUB_REPO + "/contents/" + encodeURIComponent(file);
    const res = await fetch(url, { headers: auth });
    if (!res.ok) return;
    const j = await res.json();
    await fetch(url, {
      method: "DELETE",
      headers: Object.assign(auth, { "User-Agent": "site-bot" }),
      body: JSON.stringify({ message: "delete: " + file, sha: j.sha }),
    });
  } catch (e) {
    console.log("unpublish: " + (e && e.message ? e.message : e));
  }
}

// ---------- КЛАВИАТУРЫ ----------
const MAIN_KB = {
  reply_markup: {
    keyboard: [
      [{ text: "🌐 Создать сайт" }],
      [{ text: "⭐ Премиум" }, { text: "📊 Мои сайты" }, { text: "ℹ️ Помощь" }],
    ],
    resize_keyboard: true,
  },
};

const STEPS = [
  ["📝 Как называется ваш проект?\nНапример: Барбершоп «Стиль»", "name"],
  ["📄 Кратко опишите, чем вы занимаетесь (1–2 предложения)", "subtitle"],
  ["📋 Перечислите услуги или товары через запятую.\nМожно с ценами: Стрижка - 500р, Борода - 300р\nИли просто отправьте «-» — подставим типовые.", "services"],
  ["📞 Контакт для связи: @юзернейм, телефон или ссылка", "contact"],
];

const PREM_STEPS = [
  ["🖼 Фото для шапки сайта (прямая ссылка на картинку)\nИли отправьте «-» — шапка будет просто градиентной.", "photo"],
  ["🎨 Выберите тему дизайна (цифра 1–4):\n1 — 🌊 Лагуна   2 — 🌸 Сакура\n3 — 🏅 Золото 4 — 💚 Изумруд\nИли «-» — стандартный цвет категории.", "theme"],
  ["💬 Свои отзывы (по одному на строку):\nАлексей - Быстро и качественно!\nМария - Отличные цены\nИли «-» — останутся стандартные отзывы.", "reviews"],
];

// ---------- /start ----------
bot.command("start", async (ctx) => {
  sessions.delete(ctx.from.id);
  if (!users[ctx.from.id]) {
    users[ctx.from.id] = { name: ctx.from.first_name || "", username: ctx.from.username || "", date: new Date().toISOString() };
    save("users.json", users);
    console.log("👥 Новый пользователь: " + ctx.from.first_name + " (ID " + ctx.from.id + ")");
  }
  const prem = isPremium(ctx.from.id);
  await ctx.reply(
    "🎄 Привет, " + (ctx.from.first_name || "друг") + "!\n\n" +
    "Я делаю красивые сайты за 4 ответа. Выбирай категорию — и через минуту получишь ссылку, которую можно кидать кому угодно.\n\n" +
    (prem
      ? "⭐ У вас ПРЕМИУМ:\n— без водяных знаков\n— фото в шапке, 4 темы, свои отзывы\n— сайт можно менять (/edit) и удалять (/delete) в любой момент!"
      : "🎁 Бесплатно: метка «Сделано в @sitemaket_bot» и стандартный дизайн.\n⭐ Премиум (" + config.PREMIUM_PRICE + " ⭐): без метки + фото, темы, свои отзывы, редактирование и удаление сайта."),
    MAIN_KB
  );
});

// ---------- МЕНЮ ----------
bot.hears("🌐 Создать сайт", async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply("🎨 Выберите категорию сайта:", { reply_markup: catKeyboard() });
});

bot.hears("⭐ Премиум", async (ctx) => {
  try {
    if (isPremium(ctx.from.id)) {
      await ctx.reply("⭐ Премиум уже активен!\n\nВсе премиум-функции разблокированы: /edit, /delete, темы, фото, свои отзывы. 🎄");
      return;
    }
    await ctx.reply(
      "⭐ ПРЕМИУМ — " + config.PREMIUM_PRICE + " звёзд (навсегда):\n\n" +
      "🚫 водяной знак исчезает\n" +
      "✏️ /edit — менять текст, услуги, фото, тему когда угодно\n" +
      "🗑 /delete — удалить свой сайт\n" +
      "🖼 своё фото в шапке сайта\n" +
      "🎨 4 темы дизайна на выбор\n" +
      "💬 свои отзывы вместо стандартных\n\n" +
      "Нажмите кнопку ниже — откроется оплата звёздами Telegram."
    );
    // grammy 1.46: (chat_id, title, description, payload, currency, prices) — БЕЗ provider_token
    await ctx.api.sendInvoice(
      ctx.chat.id,
      "⭐ Премиум SITE-MAKER",
      "Редактирование, темы, фото, свои отзывы + сайт без водяных знаков",
      "premium:" + ctx.from.id,
      "XTR",
      [{ label: "Премиум навсегда", amount: config.PREMIUM_PRICE }]
    );
  } catch (e) {
    console.log("Кнопка Премиум: " + (e && e.message ? e.message : e));
    await ctx.reply("⚠️ Не удалось открыть оплату. Попробуйте через минуту.");
  }
});

bot.hears("📊 Мои сайты", async (ctx) => {
  const list = mySites[ctx.from.id] || [];
  if (!list.length) return ctx.reply("📭 У вас пока нет сайтов. Жмите «🌐 Создать сайт»!");
  const rows = list.slice(-10).reverse().map((e) => {
    const f = typeof e === "string" ? e : e.file;
    return [{ text: "🔗 " + f.slice(0, 22), url: siteLink(f) }];
  });
  await ctx.reply("📊 Ваши сайты (последние 10):", { reply_markup: { inline_keyboard: rows } });
});

bot.hears("ℹ️ Помощь", async (ctx) =>
  ctx.reply(
    "ℹ️ Как это работает:\n\n" +
    "1) «🌐 Создать сайт» → выбираете категорию\n" +
    "2) Отвечаете на 4 вопроса: название, описание, услуги, контакт\n" +
    (isPremium(ctx.from.id) ? "3) ⭐ Премиум: ещё 3 шага — фото, тема, отзывы\n4) Ссылка готова" : "3) Получаете ссылку на сайт") + "\n\n" +
    "⭐ Премиум-команды:\n" +
    "✏️ /edit — выбрать сайт и изменить текст/фото/тему\n" +
    "🗑 /delete — удалить свой сайт\n\n" +
    "⏳ После публикации подождите 1–2 минуты (GitHub Pages).\n" +
    "❌ Отменить создание: /cancel\n" +
    "📊 Статистика: /stats (только админ)"
  )
);

bot.command("cancel", async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply("❌ Отменено.", MAIN_KB);
});

bot.command("stats", async (ctx) => {
  if (ctx.from.id !== config.ADMIN_ID) return;
  await ctx.reply(
    "📊 Статистика:\n\n" +
    "👥 Пользователей: " + Object.keys(users).length +
    "\n🌐 Сайтов создано: " + (stats.sites || 0) +
    "\n⭐ Премиум-пользователей: " + Object.keys(premium).length
  );
});

bot.command("users", async (ctx) => {
  if (ctx.from.id !== config.ADMIN_ID) return;
  const list = Object.entries(users).slice(-10).reverse();
  if (!list.length) return ctx.reply("📭 Пока никто не запускал бота.");
  const txt = list.map(([id, u]) =>
    "ID " + id + " — " + (u.name || "без имени") + (u.username ? " @" + u.username : "")
  ).join("\n");
  await ctx.reply("👥 Последние пользователи:\n\n" + txt);
});

bot.command("give", async (ctx) => {
  if (ctx.from.id !== config.ADMIN_ID) return;
  const id = ctx.message.text.split(/\s+/)[1];
  if (!id || !/^\d+$/.test(id)) return ctx.reply("Формат: /give 123456789");
  premium[id] = { date: new Date().toISOString(), manual: true };
  save("premium.json", premium);
  await ctx.reply("✅ Премиум выдан: " + id);
  try { await ctx.api.sendMessage(Number(id), "⭐ Вам выдан ПРЕМИУМ!\n\nВсе премиум-функции открыты: /edit, /delete, темы, фото, отзывы."); } catch {}
});

bot.command("take", async (ctx) => {
  if (ctx.from.id !== config.ADMIN_ID) return;
  const id = ctx.message.text.split(/\s+/)[1];
  if (!id || !/^\d+$/.test(id)) return ctx.reply("Формат: /take 123456789");
  delete premium[id];
  save("premium.json", premium);
  await ctx.reply("🔄 Премиум снят: " + id);
});


// ---------- ВЫБОР САЙТА ДЛЯ EDIT/DELETE ----------
const pickSiteKeyboard = (uid) => {
  const full = mySites[uid] || [];
  const start = Math.max(0, full.length - 10); // показываем последние 10
  const rows = [];
  for (let i = full.length - 1; i >= start; i--) {
    const f = typeof full[i] === "string" ? full[i] : full[i].file;
    rows.push([{ text: "🔗 " + f.slice(0, 24), callback_data: "pick:" + i }]);
  }
  return { inline_keyboard: rows };
};

const editFieldKeyboard = () => ({
  inline_keyboard: [
    [{ text: "📝 Название", callback_data: "edit:name" }, { text: "📄 Описание", callback_data: "edit:subtitle" }],
    [{ text: "📋 Услуги", callback_data: "edit:services" }, { text: "📞 Контакт", callback_data: "edit:contact" }],
    [{ text: "🖼 Фото шапки", callback_data: "edit:photo" }, { text: "🎨 Тема", callback_data: "edit:theme" }],
    [{ text: "💬 Отзывы", callback_data: "edit:reviews" }, { text: "✅ Готово", callback_data: "edit:done" }],
  ],
});

bot.command("edit", async (ctx) => {
  if (!isPremium(ctx.from.id)) {
    return ctx.reply("⭐ Редактирование — премиум-функция.\n\nЖмите «⭐ Премиум» — и сможете менять свой сайт когда угодно: текст, фото, тему, контакты.");
  }
  const list = mySites[ctx.from.id] || [];
  if (!list.length) return ctx.reply("📭 У вас пока нет сайтов для редактирования.");
  sessions.set(ctx.from.id, { mode: "pick", want: "edit" });
  await ctx.reply("✏️ Какой сайт редактируем?", { reply_markup: pickSiteKeyboard(ctx.from.id) });
});

bot.command("delete", async (ctx) => {
  if (!isPremium(ctx.from.id)) {
    return ctx.reply("⭐ Удаление сайтов — премиум-функция.\n\nЖмите «⭐ Премиум» — и сможете убирать свои сайты в любой момент.");
  }
  const list = mySites[ctx.from.id] || [];
  if (!list.length) return ctx.reply("📭 У вас нет сайтов для удаления.");
  sessions.set(ctx.from.id, { mode: "pick", want: "delete" });
  await ctx.reply("🗑 Какой сайт удалить? Это необратимо!", { reply_markup: pickSiteKeyboard(ctx.from.id) });
});

// ---------- ОПЛАТА (Stars/XTR) ----------
bot.on("pre_checkout_query", async (ctx) => { try { await ctx.answerPreCheckoutQuery(true); } catch (e) {
  try { await ctx.answerPreCheckoutQuery(false, { error_message: "Ошибка оплаты, попробуйте позже." }); } catch {}
} });

bot.on("message:successful_payment", async (ctx) => {
  try {
    premium[ctx.from.id] = { date: new Date().toISOString() };
    save("premium.json", premium);
    console.log("✅ Премиум куплен: " + ctx.from.id);
    await ctx.reply(
      "🎉 Премиум активирован!\n\n" +
      "Теперь доступно:\n" +
      "✏️ /edit — изменить любой свой сайт (текст, фото, тема)\n" +
      "🗑 /delete — удалить сайт\n" +
      "🖼 фото, 🎨 темы, 💬 свои отзывы при создании\n\n" +
      "Создайте новый сайт — он будет без водяного знака. ⭐",
      MAIN_KB
    );
  } catch (e) {
    console.log("successful_payment: " + (e && e.message ? e.message : e));
  }
});

// ---------- ЕДИНЫЙ ОБРАБОТЧИК КНОПОК ----------
bot.on("callback_query:data", async (ctx) => {
  const d = ctx.callbackQuery.data;
  const uid = ctx.from.id;
  try {
    // --- выбор категории (создание) ---
    if (d.startsWith("cat:")) {
      const key = d.slice(4);
      if (!CATS[key]) return await ctx.answerCallbackQuery({ text: "Категория не найдена" });
      sessions.set(uid, { mode: "create", cat: key, step: 0, premStep: 0, data: {} });
      await ctx.answerCallbackQuery();
      return ctx.reply(CATS[key].icon + " " + CATS[key].name + " — отличный выбор!\n\n" + STEPS[0][0]);
    }

    // --- выбор сайта для edit/delete ---
    if (d.startsWith("pick:")) {
      const s = sessions.get(uid);
      const idx = parseInt(d.slice(5), 10);
      const rec = (mySites[uid] || [])[idx];
      if (!rec) return await ctx.answerCallbackQuery({ text: "Сайт не найден" });
      const file = typeof rec === "string" ? rec : rec.file;
      await ctx.answerCallbackQuery();

      if (s && s.want === "delete") {
        sessions.delete(uid);
        const m = await ctx.reply("⏳ Удаляю сайт…");
        await unpublish(file);
        mySites[uid] = (mySites[uid] || []).filter((e) => (typeof e === "string" ? e : e.file) !== file);
        save("mysites.json", mySites);
        return ctx.api.editMessageText(m.chat.id, m.message_id, "🗑 Сайт удалён: " + file);
      }

      sessions.set(uid, { mode: "editmenu", siteIndex: idx });
      return ctx.reply("✏️ Что меняем на «" + file + "»?", { reply_markup: editFieldKeyboard() });
    }

    // --- выбор поля редактирования ---
    if (d.startsWith("edit:")) {
      const field = d.slice(5);
      const s = sessions.get(uid);
      if (!s || s.mode !== "editmenu") return await ctx.answerCallbackQuery({ text: "Сессия истекла, начните с /edit" });
      await ctx.answerCallbackQuery();
      if (field === "done") {
        sessions.delete(uid);
        return ctx.reply("✅ Редактирование завершено. Изменения на сайте: ⏳ 1–2 минуты.", MAIN_KB);
      }
      const prompts = {
        name: "📝 Отправьте новое название сайта:",
        subtitle: "📄 Отправьте новое описание (1–2 предложения):",
        services: "📋 Отправьте услуги через запятую (или «-» — типовые):",
        contact: "📞 Отправьте новый контакт (@юзернейм, телефон или ссылка):",
        photo: "🖼 Отправьте прямую ссылку на фото для шапки (или «-» — убрать):",
        theme: "🎨 Отправьте цифру темы 1–4 (или «-» — стандартная):\n1 🌊 Лагуна  2 🌸 Сакура  3 🏅 Золото  4 💚 Изумруд",
        reviews: "💬 Отправьте отзывы построчно: Имя - Текст (или «-» — стандартные):",
      };
      sessions.set(uid, { mode: "editfield", siteIndex: s.siteIndex, field });
      return ctx.reply(prompts[field] || "Отправьте новое значение:");
    }

    await ctx.answerCallbackQuery();
  } catch (e) {
    console.log("callback: " + (e && e.message ? e.message : e));
  }
});

// ---------- ДИАЛОГ: создание + редактирование ----------
bot.on("message:text", async (ctx) => {
  const uid = ctx.from.id;
  const s = sessions.get(uid);
  if (!s) return ctx.reply("Выберите действие в меню 👇", MAIN_KB);

  try {
    // --- РЕЖИМ РЕДАКТИРОВАНИЯ ---
    if (s.mode === "editfield") {
      let val = ctx.message.text.trim();
      const rec = (mySites[uid] || [])[s.siteIndex];
      if (!rec || typeof rec === "string") { sessions.delete(uid); return ctx.reply("⚠️ Сайт не найден. Начните заново с /edit"); }

      if (s.field === "theme") {
        const t = val.match(/[1-4]/);
        if (!t && val !== "-") return ctx.reply("🎨 Отправьте цифру 1–4 или «-» для стандартной темы.");
        val = t ? t[0] : "";
      }
      if (val === "-") val = "";

      rec.data = rec.data || {};
      rec.data[s.field] = val;

      const progress = await ctx.reply("⏳ Пересобираю сайт…");
      const html = buildSite(rec.cat, rec.data, true, rec.data.theme);
      await publish(rec.file, html);
      save("mysites.json", mySites);
      await ctx.api.editMessageText(progress.chat.id, progress.message_id, "✅ Готово! Сайт обновлён.");
      await ctx.reply(
        "⏳ Через 1–2 минуты изменения появятся на том же адресе:\n\n" + siteLink(rec.file) +
        "\n\nХотите поменять что-то ещё — снова /edit",
        { reply_markup: { inline_keyboard: [[{ text: "🔗 Открыть сайт", url: siteLink(rec.file) }]] } }
      );
      sessions.delete(uid);
      return;
    }

    // --- СОЗДАНИЕ: базовые шаги ---
    if (s.mode !== "create") return ctx.reply("Выберите действие в меню 👇", MAIN_KB);
    const field = STEPS[s.step][1];
    val = ctx.message.text.trim();
    if (field === "services" && val === "-") val = "";
    s.data[field] = val;
    s.step++;

    if (s.step < STEPS.length) {
      return ctx.reply(STEPS[s.step][0]);
    }

    // --- ПРЕМИУМ-ШАГИ ---
    if (isPremium(uid)) {
      const pf = PREM_STEPS[s.premStep][1];
      let pval = ctx.message.text.trim();
      if (pf === "theme") {
        const t = pval.match(/[1-4]/);
        if (!t && pval !== "-") return ctx.reply("🎨 Отправьте цифру 1–4 или «-» для стандартной темы.");
        pval = t ? t[0] : "";
      }
      if (pval === "-") pval = "";
      s.data[pf] = pval;
      s.premStep++;

      if (s.premStep < PREM_STEPS.length) {
        return ctx.reply(PREM_STEPS[s.premStep][0]);
      }
    }

    // --- ПУБЛИКАЦИЯ ---
    sessions.delete(uid);
    const prem = isPremium(uid);
    const msgs = ["🛠 Собираю каркас…", "🎨 Наношу дизайн…", "✨ Добавляю анимации…", "🚀 Публикую…"];
    const progress = await ctx.reply("⏳ " + msgs[0]);
    for (let i = 1; i < msgs.length; i++) {
      await new Promise((r) => setTimeout(r, 900));
      await ctx.api.editMessageText(progress.chat.id, progress.message_id, "" + (i < msgs.length - 1 ? "⏳ " : "") + msgs[i]);
    }

    const file = slug(s.data.name) + ".html";
    const html = buildSite(s.cat, s.data, prem, s.data.theme);

    if (!config.GITHUB_TOKEN || !config.GITHUB_REPO) {
      const { InputFile } = require("grammy");
      return ctx.replyWithDocument(new InputFile(Buffer.from(html, "utf8"), file));
    }

    await publish(file, html);
    stats.sites++;
    save("stats.json", stats);
    (mySites[uid] = mySites[uid] || []).push({ file, cat: s.cat, data: s.data });
    save("mysites.json", mySites);

    await ctx.api.editMessageText(progress.chat.id, progress.message_id, "✅ Готово!");
    await ctx.reply(
      (prem ? "⭐ PREMIUM-сайт готов! Без водяных знаков.\n\n" : "🎁 Сайт готов (с меткой фри-версии)!\n\n") +
      "⏳ Подождите 1–2 минуты — потом открывайте:\n\n" + siteLink(file) +
      (prem ? "\n\n✏️ Изменить сайт: /edit — текст, фото, тема" : "\n\n⭐ Премиум убирает метку и открывает /edit, /delete, темы и фото"),
      { reply_markup: { inline_keyboard: [[{ text: "🔗 Открыть сайт", url: siteLink(file) }]] } }
    );
  } catch (e) {
    console.log("Создание сайта: " + (e && e.message ? e.message : e));
    await ctx.reply("⚠️ Не удалось опубликовать сайт. Попробуйте ещё раз (GitHub может быть занят деплоем — подождите минуту).", MAIN_KB);
  }
});

// ---------- ГЛОБАЛЬНАЯ ЗАЩИТА ----------
bot.catch((err) => {
  const msg = err && err.error && err.error.message ? err.error.message : String(err);
  console.log("⚠️ Ошибка (не критично): " + msg);
});

bot.start();
console.log("🎄 Бот v6 PREMIUM+ запущен — grammy 1.46, премиум " + config.PREMIUM_PRICE + "⭐");
