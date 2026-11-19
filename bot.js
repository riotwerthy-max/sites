/* ============================================================
   Site-Maker v8.2 FIXED — @sitemaket_bot
   - правка сообщений через ctx.api.editMessageText (без бага)
   - ссылка отправляется сразу после коммита (без ожидания Pages)
   - таймауты на все запросы — ничего не висит вечно
   - /diag — проверка токенов и прав (для админа)
   - каждое действие пишется в логи Render
   ============================================================ */

const { Bot, InlineKeyboard } = require("grammy");
const http = require("http");
const crypto = require("crypto");

const VERSION = "v8.2 FIXED";

// ---------- Переменные окружения ----------
let TG_TOKEN = process.env.TG_TOKEN || "";
try { if (!TG_TOKEN) TG_TOKEN = require("./config").token || ""; } catch (e) {}
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const REPO_OWNER = "riotwerthy-max";
const REPO_NAME = "sites";
const BASE_URL = "https://" + REPO_OWNER + ".github.io/" + REPO_NAME;
const ADMIN_ID = Number(process.env.ADMIN_ID || 6038097684);
const PREMIUM_STARS = Number(process.env.PREMIUM_PRICE || 100);

if (!TG_TOKEN) { console.error("ОШИБКА: TG_TOKEN не задан. Выходим."); process.exit(1); }
console.log("[diag] TG_TOKEN: задан ✅");
console.log("[diag] GITHUB_TOKEN: " + (GITHUB_TOKEN ? "задан ✅" : "НЕ ЗАДАН ❌ — сайты не опубликуются!"));
console.log("[diag] Репозиторий: " + REPO_OWNER + "/" + REPO_NAME);

// ---------- fetch с таймаутом ----------
function fetchT(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms || 15000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(() => clearTimeout(t));
}

// ---------- Веб-сервер ----------
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Site-Maker bot " + VERSION + " работает 🎄");
}).listen(PORT, () => console.log("[diag] Порт " + PORT + " ОК"));

// ---------- Пользователи ----------
const users = new Map();
function U(from) {
  if (!users.has(from.id)) users.set(from.id, { step: null, data: {}, sites: [], premium: false, trialUsed: false, premiumUntil: 0 });
  const u = users.get(from.id);
  if (u.premiumUntil && Date.now() > u.premiumUntil) { u.premium = false; u.premiumUntil = 0; }
  return u;
}
let adminNotify = false;

// ---------- Пробный премиум 5 минут ----------
async function startTrial(ctx) {
  const u = U(ctx.from);
  if (u.premium) return ctx.reply("⭐ У тебя уже активен премиум!");
  if (ctx.from.id === ADMIN_ID) {
    u.premium = true;
    u.premiumUntil = 0;
    return ctx.reply("👑 Премиум админа активирован навсегда! 🎄");
  }
  if (u.trialUsed) return ctx.reply("🎁 Пробный премиум можно взять только один раз.\n\n⭐ Навсегда: /premium");
  u.trialUsed = true;
  u.premium = true;
  u.premiumUntil = Date.now() + 5 * 60 * 1000;
  await ctx.reply("⭐ ПРЕМИУМ НА 5 МИНУТ АКТИВЕН!\n\n• До 12 услуг с ценами\n• 8 отзывов и 8 FAQ\n• Кнопка «Связаться» на сайте\n\n⏱ Успей собрать сайт: /start");
  setTimeout(() => {
    if (u.premiumUntil && Date.now() >= u.premiumUntil) {
      u.premium = false;
      u.premiumUntil = 0;
      ctx.api.sendMessage(ctx.from.id, "⏰ Пробный премиум закончился. Спасибо, что попробовал! ⭐ Полный: /premium").catch(() => {});
    }
  }, 5 * 60 * 1000);
}


const CATEGORIES = {
  shop:    { title: "🛍 Магазин",       emoji: "🛍" },
  auto:    { title: "🚗 Автосервис",    emoji: "🚗" },
  scooter: { title: "🛴 Прокат аренда", emoji: "🛴" },
  sports:  { title: "💪 Спорт/фитнес",  emoji: "💪" },
  artist:  { title: "🎤 Концерт/шоу",   emoji: "🎤" },
  barber:  { title: "💈 Барбершоп",     emoji: "💈" },
  beauty:  { title: "💅 Салон красоты", emoji: "💅" },
  coffee:  { title: "☕ Кофейня",       emoji: "☕" },
  master:  { title: "🔧 Ремонт/Мастер", emoji: "🔧" }
};

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function slug(s) {
  const r = String(s || "site").toLowerCase().trim()
    .replace(/[^0-9A-Za-z\u0400-\u04FF]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  return r || "site";
}

// ---------- GitHub API ----------
async function gh(path, method, body) {
  const url = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + encodeURIComponent(path);
  console.log("[gh] " + method + " " + path);
  const res = await fetchT(url, {
    method,
    headers: {
      "Authorization": "token " + GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "site-maker-bot"
    },
    body: body ? JSON.stringify(body) : undefined
  }, 20000);
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 200);
    console.error("[gh] ОШИБКА " + res.status + ": " + txt);
    throw new Error("GitHub API " + res.status + ": " + txt);
  }
  console.log("[gh] " + method + " " + path + " — успех ✅");
  return res.status === 204 ? null : res.json();
}

async function publishSite(fileName, html) {
  await gh(fileName, "PUT", {
    message: "site: " + fileName,
    content: Buffer.from(html, "utf8").toString("base64")
  });
}

// ---------- Диагностика ----------
async function diagReport(ctx) {
  const lines = ["🔬 Диагностика " + VERSION + ":\n"];
  lines.push("TG_TOKEN: " + (TG_TOKEN ? "✅" : "❌"));
  lines.push("GITHUB_TOKEN: " + (GITHUB_TOKEN ? "✅" : "❌ НЕ ЗАДАН в Environment!"));
  if (GITHUB_TOKEN) {
    try {
      const r = await fetchT("https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME, {
        headers: { "Authorization": "token " + GITHUB_TOKEN, "User-Agent": "site-maker-bot", "Accept": "application/vnd.github+json" }
      }, 15000);
      if (r.ok) {
        const j = await r.json();
        lines.push("Репозиторий: ✅ доступен (права: " + (j.permissions ? (j.permissions.push ? "push ✅" : "только чтение ❌") : "?") + ")");
      } else {
        lines.push("Репозиторий: ❌ HTTP " + r.status + (r.status === 401 ? " — токен неверный/протух" : r.status === 403 ? " — нет прав" : ""));
      }
    } catch (e) { lines.push("Репозиторий: ❌ сеть: " + e.message); }
  }
  try {
    const r = await fetchT(BASE_URL + "/", {}, 10000);
    lines.push("GitHub Pages: " + (r.ok ? "✅ работает" : "❌ HTTP " + r.status));
  } catch (e) { lines.push("GitHub Pages: ❌ " + e.message); }
  lines.push("\nБот: запущен ✅");
  lines.push("Пользователей в памяти: " + users.size);
  return ctx.reply(lines.join("\n"));
}

// ---------- HTML-шаблон ----------
function buildSite(d) {
  const name = esc(d.name || "Мой сайт");
  const cat = CATEGORIES[d.category] || CATEGORIES.shop;
  const fileName = slug(d.name) + "-" + crypto.randomBytes(3).toString("hex") + ".html";
  const nav = ["about", "services", "reviews", "faq", "contacts"].map((a, i) => (
    `<a href="#${a}">${["О нас", "Услуги", "Отзывы", "FAQ", "Контакты"][i]}</a>`
  )).join("\n");

const items = (d.items || []).slice(0, d.premium ? 12 : 4);
  const itemsHtml = items.length ? items.map((it) => (
    `<div class="card"><div class="ph">${esc(it.emoji || cat.emoji)}</div><h3>${esc(it.title)}</h3><p>${esc(it.text || "")}</p>${d.premium && it.price ? `<span class="price">${esc(it.price)}</span>` : ""}</div>`
  )).join("\n") : `<div class="card"><div class="ph">${cat.emoji}</div><h3>${esc(name)}</h3><p>${esc(d.bonus || "")}</p></div>`;

const reviews = (d.reviews || []).slice(0, d.premium ? 8 : 3);
  const reviewsHtml = reviews.length ? reviews.map((r) => (
    `<div class="card"><h3>${esc(r.name)}</h3><p>«${esc(r.text)}»</p><span class="stars">★★★★★</span></div>`
  )).join("\n") : "";

const faqHtml = (d.faq || []).slice(0, d.premium ? 8 : 3).map((f) => (
    `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`
  )).join("\n");

return { fileName, html: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${cat.emoji}</text></svg>">
<style>
:root{--primary:#3a7bd5;--secondary:#00d2ff;--accent:#38bdf8;--text:#f4f7ff;--muted:#a9b9d8;--border:rgba(255,255,255,.13)}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{min-height:100vh;color:var(--text);font-family:Inter,system-ui,sans-serif;line-height:1.65;background:radial-gradient(circle at 15% 10%,rgba(58,123,213,.22),transparent 28%),radial-gradient(circle at 85% 20%,rgba(0,210,255,.22),transparent 30%),linear-gradient(145deg,#030610,#0a142a 48%,#050914)}
.wrap{width:min(1120px,calc(100% - 32px));margin:auto}
nav{position:sticky;top:0;z-index:40;display:flex;justify-content:center;flex-wrap:wrap;gap:8px;padding:14px 18px;background:rgba(5,9,20,.72);border-bottom:1px solid var(--border);backdrop-filter:blur(18px)}
nav a{color:#dbe7ff;text-decoration:none;font-size:.86rem;padding:7px 14px;border:1px solid var(--border);border-radius:999px;transition:.25s}
nav a:hover{color:#fff;border-color:var(--accent)}
section{padding:64px 0}
h1{font-size:clamp(2rem,5vw,3.4rem);margin-bottom:14px}
h2{font-size:clamp(1.4rem,3vw,2rem);margin-bottom:24px;text-align:center}
p{color:var(--muted)}
.hero{display:grid;place-items:center;text-align:center;padding:100px 24px 76px;border:1px solid var(--border);border-radius:34px;margin-top:28px;background:linear-gradient(135deg,rgba(12,24,52,.9),rgba(8,13,31,.76));box-shadow:0 30px 90px rgba(0,0,0,.36)}
.badge{display:inline-block;background:rgba(56,189,248,.14);border:1px solid var(--accent);color:var(--accent);padding:6px 14px;border-radius:999px;font-size:.85rem;margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px;margin-top:28px}
.card{background:rgba(13,24,48,.72);border:1px solid var(--border);border-radius:20px;padding:26px;transition:.25s}
.card:hover{transform:translateY(-4px);border-color:var(--accent)}
.ph{font-size:2.2rem;margin-bottom:10px}
.price{display:inline-block;margin-top:10px;color:var(--accent);font-weight:600}
.stars{color:#fbbf24}
details{background:rgba(13,24,48,.72);border:1px solid var(--border);border-radius:14px;padding:18px 22px;margin-bottom:12px}
summary{cursor:pointer;font-weight:600}
details p{margin-top:10px}
.btn{display:inline-block;margin-top:22px;padding:14px 32px;border-radius:999px;background:linear-gradient(90deg,var(--primary),var(--secondary));color:#fff;text-decoration:none;font-weight:600}
footer{border-top:1px solid var(--border);margin-top:60px;padding:34px 0;text-align:center;color:var(--muted);font-size:.9rem}
@media(max-width:640px){section{padding:44px 0}}
</style>
</head>
<body>
<nav class="wrap">${nav}</nav>
<div class="wrap">
<section class="hero" id="top">
<div class="badge">${cat.title}</div>
<h1>${name}</h1>
<p>${esc(d.bonus || "")}</p>
${d.premium ? '<a class="btn" href="#contacts">Связаться</a>' : ""}
</section>
<section id="about"><h2>О нас</h2><p>${esc(d.about || "Расскажите о своей компании в двух словах.")}</p></section>
<section id="services"><h2>Услуги</h2><div class="grid">${itemsHtml}</div></section>
${reviewsHtml ? `<section id="reviews"><h2>Отзывы</h2><div class="grid">${reviewsHtml}</div></section>` : ""}
${faqHtml ? `<section id="faq"><h2>Частые вопросы</h2>${faqHtml}</section>` : ""}
<section id="contacts"><h2>Контакты</h2><p>${esc(d.contacts || "Телефон, адрес и соцсети добавьте здесь.")}</p></section>
<footer>Сделано с 🎄 Site-Maker</footer>
</div>
</body>
</html>` };
}

// ---------- Меню и анкета ----------
function backMenu() {
  return new InlineKeyboard()
    .text("🛍 Магазин", "cat:shop").row()
    .text("🚗 Автосервис", "cat:auto").text("🛴 Прокат", "cat:scooter").row()
    .text("💪 Спорт", "cat:sports").text("🎤 Шоу", "cat:artist").row()
    .text("💈 Барбершоп", "cat:barber").text("💅 Красота", "cat:beauty").row()
    .text("☕ Кофейня", "cat:coffee").text("🔧 Мастер", "cat:master").row()
    .text("🎁 Премиум 5 мин", "trial").text("⭐ Премиум", "premium").row()
    .text("📊 Статистика", "stats").text("ℹ️ Помощь", "help");
}


const STEP_TEXTS = {
  name: "✍️ Как назовём сайт? (например: «Бородатый»)",
  about: "📝 Опиши компанию в 1–2 предложениях",
  items: "🧾 Перечисли услуги/товары, по одной в строке. Формат:\n`Название - описание`\nИли нажми «Пропустить»",
  items_p: "🧾 Перечисли услуги/товары (до 12), по одной в строке. Формат:\n`Название - описание - цена`\nИли нажми «Пропустить»",
  reviews: "⭐ Отзывы, по одному в строке. Формат:\n`Имя - текст отзыва`\nИли нажми «Пропустить»",
  faq: "❓ Вопросы-ответы, по одному в строке. Формат:\n`Вопрос? - Ответ`\nИли нажми «Пропустить»",
  contacts: "📞 Контакты: телефон, адрес, соцсети — одной строкой"
};

async function askStep(ctx) {
  const s = U(ctx.from).step;
  const kb = ["items", "items_p", "reviews", "faq"].includes(s) ? new InlineKeyboard().text("⏭ Пропустить", "skip") : undefined;
  await ctx.reply(STEP_TEXTS[s] || "Готово", kb ? { parse_mode: "Markdown", reply_markup: kb } : {});
}

function parseLines(text, fields) {
  return String(text).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const parts = l.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
    const o = { title: parts[0] || "" };
    if (parts[1] && fields >= 2) o.text = parts[1];
    if (parts[2] && fields >= 3) o.price = parts[2];
    return o;
  }).filter((o) => o.title).slice(0, 12);
}

function parseQA(text) {
  return String(text).split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const p = l.split(/\s+[-–—]\s+/).map((x) => x.trim());
    return { q: p[0] || "", a: p[1] || "" };
  }).filter((f) => f.q).slice(0, 8);
}

// ---------- Сборка ----------
async function editMsg(ctx, m, text, extra) {
  try {
    await ctx.api.editMessageText(m.chat.id, m.message_id, text, extra || {});
  } catch (e) {
    console.error("[edit] " + (e.message || e));
  }
}

async function finish(ctx) {
  const u = U(ctx.from);
  console.log("[finish] Сборка для user " + ctx.from.id);
  const m = await ctx.reply("⏳ Собираю сайт...\n\n`1/3` Генерирую страницу 🎨", { parse_mode: "Markdown" });
  try {
    const { fileName, html } = buildSite(u.data);
    console.log("[finish] Файл: " + fileName + " (" + Math.round(html.length / 1024) + " КБ)");
    if (!GITHUB_TOKEN) {
      throw new Error("GITHUB_TOKEN не задан на Render");
    }
    await editMsg(ctx, m, "⏳ Собираю сайт...\n\n`1/3` Генерирую страницу ✅\n`2/3` Публикую на GitHub... ⏳", { parse_mode: "Markdown" });
    await publishSite(fileName, html);
    console.log("[finish] Опубликовано: " + fileName);
    const url = BASE_URL + "/" + encodeURIComponent(fileName);
    u.sites.push({ name: u.data.name, url: url });
    await editMsg(ctx, m, "✅ Готово! Твой сайт:\n\n" + url + "\n\n⚠️ Если ссылка пока не открывается — GitHub Pages собирает его 1–2 минуты, просто обнови страницу позже.\n\n📄 " + fileName, { reply_markup: new InlineKeyboard().url("🌐 Открыть сайт", url) });
    if (adminNotify && ctx.from.id !== ADMIN_ID) {
      try {
        await ctx.api.sendMessage(ADMIN_ID, "🔔 Новый сайт: " + u.data.name + "\n" + url);
      } catch (e) {}
    }
  } catch (e) {
    console.error("[finish] ОШИБКА: " + (e.message || e));
    await editMsg(ctx, m, "❌ Не получилось: " + (e.message || e) + "\n\nПопробуй снова через минуту: /start");
  }
  u.step = null;
}

// ---------- Бот ----------
const bot = new Bot(TG_TOKEN);

bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  U(ctx.from).step = null;
  await ctx.reply("🎄 Site-Maker " + VERSION + "\n\nПривет" + (ctx.from.first_name ? ", " + ctx.from.first_name : "") +
    "! Выбери категорию — соберу сайт за минуту.",
    { reply_markup: backMenu() });
});

bot.command("help", (ctx) => ctx.reply(
  "ℹ️ Как создать сайт:\n1️⃣ /start → категория\n2️⃣ Ответь на вопросы анкеты\n3️⃣ Получишь рабочую ссылку\n\n" +
  "⭐ /premium — расширенный тариф\n📊 /stats — статистика\n🔬 /diag — диагностика (админ)\n🔕 /notify on|off — уведомления админу"
));

async function sendStats(ctx) {
  const total = [...users.values()].reduce((s, u) => s + u.sites.length, 0);
  const prem = [...users.values()].filter((u) => u.premium).length;
  await ctx.reply("📊 Статистика:\n\n👥 Пользователей: " + users.size + "\n🌐 Сайтов создано: " + total + "\n⭐ Премиум: " + prem);
}
bot.command("stats", sendStats);

bot.command("notify", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply("Только для админа 🙂");
  const arg = String(ctx.match || "").toLowerCase();
  adminNotify = arg === "on" || arg === "вкл";
  ctx.reply("🔕 Уведомления админу: " + (adminNotify ? "ВКЛЮЧЕНЫ ✅" : "ВЫКЛЮЧЕНЫ ❌"));
});

bot.command("diag", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply("Только для админа 🙂");
  return diagReport(ctx);
});

bot.command("premium", (ctx) => ctx.reply(
  "⭐ Премиум-тариф — " + PREMIUM_STARS + " ⭐ Stars\n\n• До 12 услуг с ценами\n• 8 отзывов и 8 FAQ\n• Кнопка «Связаться» на сайте",
  { reply_markup: new InlineKeyboard().text("⭐ Оплатить " + PREMIUM_STARS + " ⭐", "buy_premium") }
));

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const u = U(ctx.from);
  try {
    if (data.startsWith("cat:")) {
      u.data = { category: data.slice(4), items: [], reviews: [], faq: [] };
      if (u.premium) u.data.premium = true;
      u.step = "name";
      await ctx.answerCallbackQuery();
      return askStep(ctx);
    }
    if (data === "skip") { await ctx.answerCallbackQuery(); return nextStep(ctx); }
    if (data === "help") { await ctx.answerCallbackQuery(); return ctx.reply("ℹ️ /start — меню, /premium — тариф"); }
    if (data === "stats") { await ctx.answerCallbackQuery(); return sendStats(ctx); }
    if (data === "premium") {
      await ctx.answerCallbackQuery();
      return ctx.reply("⭐ Премиум — " + PREMIUM_STARS + " ⭐", { reply_markup: new InlineKeyboard().text("⭐ Оплатить " + PREMIUM_STARS + " ⭐", "buy_premium") });
    }
    if (data === "buy_premium") {
      await ctx.answerCallbackQuery();
      return ctx.replyWithInvoice("⭐ Премиум Site-Maker", "Расширенный тариф: 12 услуг, цены, кнопки", "premium_" + ctx.from.id, "XTR", [{ label: PREMIUM_STARS + " ⭐", amount: PREMIUM_STARS }]);
    }
    await ctx.answerCallbackQuery();
  } catch (e) {
    console.error("[callback] ОШИБКА: " + (e.message || e));
    try { await ctx.answerCallbackQuery(); } catch (_) {}
  }
});

bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on("message:successful_payment", async (ctx) => {
  const u = U(ctx.from);
  u.premium = true;
  u.data.premium = true;
  await ctx.reply("⭐ Премиум активирован! Спасибо! 🎄");
});

bot.on("message:text", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  const u = U(ctx.from);
  if (!u.step) return;
  const t = (ctx.message.text || "").trim();
  if (!t || t.startsWith("/")) return;
  const s = u.step;

if (s === "name") { u.data.name = t.slice(0, 40); u.step = "about"; return askStep(ctx); }
  if (s === "about") { u.data.about = t.slice(0, 400); u.step = u.premium ? "items_p" : "items"; return askStep(ctx); }
  if (s === "items" || s === "items_p") {
    u.data.items = u.premium ? parseLines(t, 3) : parseLines(t, 2);
    u.step = "reviews"; return askStep(ctx);
  }
  if (s === "reviews") {
    u.data.reviews = parseLines(t, 2).map((r) => ({ name: r.title, text: r.text || "Отличный сервис!" }));
    u.step = "faq"; return askStep(ctx);
  }
  if (s === "faq") { u.data.faq = parseQA(t); u.step = "contacts"; return askStep(ctx); }
  if (s === "contacts") { u.data.contacts = t.slice(0, 300); return finish(ctx); }
});

function nextStep(ctx) {
  const u = U(ctx.from);
  const s = u.step;
  if (s === "items" || s === "items_p") { u.step = "reviews"; return askStep(ctx); }
  if (s === "reviews") { u.step = "faq"; return askStep(ctx); }
  if (s === "faq") { u.step = "contacts"; return askStep(ctx); }
  askStep(ctx);
}

// ---------- Запуск ----------
async function startBot() {
  bot.catch((err) => console.error("[bot] ОШИБКА: " + ((err.error && err.error.message) || err.message)));
  for (;;) {
    try {
      await bot.init();
      await bot.start({
        drop_pending_updates: false,
        onStart: (me) => console.log("🎄 " + VERSION + " запущен: @" + me.username)
      });
      return;
    } catch (e) {
      console.error("[start] Не удалось: " + String(e.message || "").slice(0, 100) + " — повтор через 10 сек...");
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}
startBot();
