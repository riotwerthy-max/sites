/* ============================================================
   Site-Maker v9 PREMIUM — @sitemaket_bot
   - богатый анимированный шаблон сайта для ВСЕХ тарифов
   - кнопки звонка/WhatsApp/Telegram/Instagram из контактов
   - пробный премиум 5 минут (кнопка 🎁, один раз)
   - премиум-сайт без подписи бота (© Название)
   - /give — админ выдаёт премиум (навсегда / на минуты / off / list)
   - таймауты на все запросы, логи, /diag
   ============================================================ */

const { Bot, InlineKeyboard } = require("grammy");
const http = require("http");
const crypto = require("crypto");

const VERSION = "v9 PREMIUM";

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
console.log("[diag] GITHUB_TOKEN: " + (GITHUB_TOKEN ? "задан ✅" : "НЕ ЗАДАН ❌"));

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
  if (!users.has(from.id)) users.set(from.id, { id: from.id, step: null, data: {}, sites: [], premium: false, trialUsed: false, premiumUntil: 0 });
  const u = users.get(from.id);
  if (u.premiumUntil && Date.now() > u.premiumUntil) { u.premium = false; u.premiumUntil = 0; }
  return u;
}
let adminNotify = false;

function grantPremium(id, ms, note) {
  if (!users.has(id)) users.set(id, { id: id, step: null, data: {}, sites: [], premium: false, trialUsed: false, premiumUntil: 0 });
  const u = users.get(id);
  u.premium = true;
  u.premiumUntil = ms ? Date.now() + ms : 0;
  if (ms) {
    setTimeout(() => {
      if (u.premiumUntil && Date.now() >= u.premiumUntil) {
        u.premium = false;
        u.premiumUntil = 0;
        if (id !== ADMIN_ID) bot.api.sendMessage(id, "⏰ Премиум закончился. Продлить: /premium").catch(() => {});
      }
    }, ms);
  }
  if (note) bot.api.sendMessage(id, note).catch(() => {});
}

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
  grantPremium(ctx.from.id, 5 * 60 * 1000, "⭐ ПРЕМИУМ НА 5 МИНУТ АКТИВЕН!\n\n• До 12 услуг с ценами\n• 8 отзывов и 8 FAQ\n• Кнопки контактов\n• Без подписи бота\n\n⏱ Успей собрать сайт: /start");
  await ctx.reply("⏱ Таймер пошёл! Жми /start и собирай премиум-сайт.");
}

// ---------- Категории, утилиты ----------
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
  const isP = !!d.premium;

const nav = ["about", "services", "reviews", "faq", "contacts"].map((a, i) => (
    `<a href="#${a}">${["О нас", "Услуги", "Отзывы", "FAQ", "Контакты"][i]}</a>`
  )).join("\n");

const items = (d.items || []).slice(0, isP ? 12 : 4);
  const itemsHtml = items.length ? items.map((it) => (
    `<article class="card reveal"><span class="emoji">${esc(it.emoji || cat.emoji)}</span><h3>${esc(it.title)}</h3><p>${esc(it.text || "")}</p>${isP && it.price ? `<span class="price">${esc(it.price)}</span>` : ""}</article>`
  )).join("\n") : `<article class="card reveal"><span class="emoji">${cat.emoji}</span><h3>${esc(name)}</h3><p>${esc(d.bonus || "")}</p></article>`;

const reviews = (d.reviews || []).slice(0, isP ? 8 : 3);
  const reviewsHtml = reviews.length ? reviews.map((r) => (
    `<article class="card quote reveal"><h3>${esc(r.name)}</h3><p>«${esc(r.text || "Отличный сервис!")}»</p><span class="stars">★★★★★</span></article>`
  )).join("\n") : "";

const faqHtml = (d.faq || []).slice(0, isP ? 8 : 3).map((f) => (
    `<details class="reveal"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`
  )).join("\n");

const raw = String(d.contacts || "");
  const pm = raw.match(/(\+?\d[\d\s\-()]{6,}\d)/);
  const phone = pm ? pm[1].trim() : "";
  const digits = phone.replace(/\D/g, "");
  let cb = "";
  if (phone) cb += '<a class="cbtn big pulse" href="tel:' + digits + '">📞 ' + esc(phone) + "</a>";
  if (digits.length >= 10) cb += '<a class="cbtn wa" target="_blank" rel="noopener" href="https://wa.me/' + digits + '">💬 WhatsApp</a>';
  const tgm = raw.match(/(?:@|t\.me\/)([A-Za-z0-9_]{4,})/);
  if (tgm) cb += '<a class="cbtn tg" target="_blank" rel="noopener" href="https://t.me/' + esc(tgm[1]) + '">✈️ Telegram</a>';
  const igm = raw.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (igm) cb += '<a class="cbtn ig" target="_blank" rel="noopener" href="https://instagram.com/' + esc(igm[1]) + '">📸 Instagram</a>';
  const cbtns = cb ? '<div class="cbtns">' + cb + "</div>" : "";

const ribbon = items.length ? items.map((it) => esc(it.title)).join(" • ") : esc(name);

return { fileName, html: `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${cat.emoji}</text></svg>">
<style>
:root{--primary:#3a7bd5;--secondary:#00d2ff;--accent:#38bdf8;--text:#f4f7ff;--muted:#a9b9d8;--border:rgba(255,255,255,.14)}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{min-height:100vh;color:var(--text);font-family:Inter,system-ui,sans-serif;line-height:1.65;overflow-x:hidden;background:#030610}
.bg{position:fixed;inset:0;z-index:-1;background:linear-gradient(145deg,#030610,#0a142a 48%,#050914)}
.orb{position:fixed;border-radius:50%;filter:blur(70px);opacity:.5;z-index:-1;animation:drift 16s ease-in-out infinite alternate}
.orb.a{width:420px;height:420px;background:rgba(58,123,213,.4);top:-120px;left:-100px}
.orb.b{width:360px;height:360px;background:rgba(0,210,255,.35);bottom:-100px;right:-80px;animation-delay:-8s}
.orb.c{width:260px;height:260px;background:rgba(168,85,247,.3);top:40%;left:60%;animation-delay:-4s}
@keyframes drift{from{transform:translate(0,0) scale(1)}to{transform:translate(60px,50px) scale(1.15)}}
.wrap{width:min(1120px,calc(100% - 32px));margin:auto}
nav{position:sticky;top:0;z-index:40;display:flex;justify-content:center;flex-wrap:wrap;gap:8px;padding:14px 18px;background:rgba(5,9,20,.72);border-bottom:1px solid var(--border);backdrop-filter:blur(18px)}
nav a{color:#dbe7ff;text-decoration:none;font-size:.86rem;padding:7px 14px;border:1px solid var(--border);border-radius:999px;transition:.25s}
nav a:hover{color:#fff;border-color:var(--accent);box-shadow:0 0 18px rgba(56,189,248,.35);transform:translateY(-2px)}
section{padding:70px 0}
h2{font-size:clamp(1.4rem,3vw,2rem);margin-bottom:26px;text-align:center}
p{color:var(--muted)}
.hero{display:grid;place-items:center;text-align:center;padding:110px 24px 84px;border:1px solid var(--border);border-radius:34px;margin-top:28px;background:linear-gradient(135deg,rgba(12,24,52,.92),rgba(8,13,31,.78));box-shadow:0 30px 90px rgba(0,0,0,.4);overflow:hidden;position:relative}
.hero:before{content:"";position:absolute;top:-60%;left:-60%;width:80%;height:220%;background:conic-gradient(from 0deg,transparent,rgba(56,189,248,.16),transparent 40%);animation:spin 7s linear infinite}
@keyframes spin{to{transform:rotate(1turn)}}
.badge{display:inline-block;background:rgba(56,189,248,.14);border:1px solid var(--accent);color:var(--accent);padding:6px 16px;border-radius:999px;font-size:.85rem;margin-bottom:20px}
h1{font-size:clamp(2.1rem,6vw,3.6rem);margin-bottom:16px;background:linear-gradient(90deg,#fff,var(--accent),#a78bfa,#fff);background-size:280% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shine 6s linear infinite}
@keyframes shine{to{background-position:280% center}}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px;margin-top:30px}
.card{background:rgba(13,24,48,.74);border:1px solid var(--border);border-radius:20px;padding:28px;transition:.3s;position:relative;overflow:hidden}
.card:before{content:"";position:absolute;inset:0;background:radial-gradient(300px circle at var(--mx,50%) var(--my,0%),rgba(56,189,248,.14),transparent 45%);opacity:0;transition:.3s}
.card:hover{transform:translateY(-6px);border-color:var(--accent);box-shadow:0 18px 48px rgba(0,0,0,.5)}
.card:hover:before{opacity:1}
.emoji{font-size:2.3rem;display:inline-block;animation:float 3.6s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.price{display:inline-block;margin-top:12px;color:var(--accent);font-weight:700;font-size:1.05rem}
.quote p{color:var(--text)}
.stars{color:#fbbf24;letter-spacing:2px}
details{background:rgba(13,24,48,.74);border:1px solid var(--border);border-radius:14px;padding:18px 22px;margin-bottom:12px;transition:.25s}
details[open]{border-color:var(--accent);box-shadow:0 0 24px rgba(56,189,248,.18)}
summary{cursor:pointer;font-weight:600;list-style:none}
details p{margin-top:10px}
.marquee{overflow:hidden;border-block:1px solid var(--border);padding:16px 0;margin-top:8px}
.marquee span{display:inline-block;white-space:nowrap;font-weight:600;color:var(--muted);animation:slide 22s linear infinite}
@keyframes slide{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.cbtns{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;margin-top:26px}
.cbtn{display:inline-flex;align-items:center;gap:8px;padding:13px 28px;border-radius:999px;color:#fff;text-decoration:none;font-weight:600;transition:.25s}
.cbtn:hover{transform:translateY(-3px) scale(1.04)}
.cbtn.big{background:linear-gradient(90deg,var(--primary),var(--secondary))}
.cbtn.wa{background:linear-gradient(90deg,#25d366,#128c7e)}
.cbtn.tg{background:linear-gradient(90deg,#38bdf8,#0284c7)}
.cbtn.ig{background:linear-gradient(90deg,#f58529,#dd2a7b)}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(56,189,248,.5)}70%{box-shadow:0 0 0 16px rgba(56,189,248,0)}100%{box-shadow:0 0 0 0 rgba(56,189,248,0)}}
.pulse{animation:pulse 2.2s infinite}
.btn{display:inline-flex;align-items:center;gap:8px;margin-top:24px;padding:15px 36px;border-radius:999px;background:linear-gradient(90deg,var(--primary),var(--secondary));color:#fff;text-decoration:none;font-weight:700;font-size:1.05rem;transition:.25s}
.btn:hover{transform:translateY(-3px) scale(1.04);box-shadow:0 14px 36px rgba(56,189,248,.4)}
.reveal{opacity:0;transform:translateY(26px);transition:.7s cubic-bezier(.2,.7,.3,1)}
.reveal.on{opacity:1;transform:none}
footer{border-top:1px solid var(--border);margin-top:60px;padding:36px 0;text-align:center;color:var(--muted);font-size:.9rem}
@media(max-width:640px){section{padding:48px 0}.hero{padding:70px 18px 56px}}
</style>
</head>
<body>
<div class="bg"></div>
<div class="orb a"></div><div class="orb b"></div><div class="orb c"></div>
<nav class="wrap">${nav}</nav>
<div class="wrap">
<section class="hero" id="top">
<div class="badge">${cat.title}</div>
<h1>${name}</h1>
<p>${esc(d.bonus || "")}</p>
<a class="btn pulse" href="#contacts">Связаться</a>
</section>
<div class="marquee"><span>${ribbon} • ${ribbon} • </span></div>
<section id="about"><h2>О нас</h2><p class="reveal">${esc(d.about || "Расскажите о своей компании в двух словах.")}</p></section>
<section id="services"><h2>Услуги</h2><div class="grid">${itemsHtml}</div></section>
${reviewsHtml ? `<section id="reviews"><h2>Отзывы</h2><div class="grid">${reviewsHtml}</div></section>` : ""}
${faqHtml ? `<section id="faq"><h2>Частые вопросы</h2>${faqHtml}</section>` : ""}
<section id="contacts" class="reveal"><h2>Контакты</h2><p>${esc(d.contacts || "Телефон, адрес и соцсети добавьте здесь.")}</p>
${cbtns}
</section>
<footer>${isP ? "© " + name : "Сделано с 🎄 Site-Maker"}</footer>
</div>
<script>
document.querySelectorAll(".card").forEach((c) => {
  c.addEventListener("mousemove", (e) => {
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", (e.clientX - r.left) + "px");
    c.style.setProperty("--my", (e.clientY - r.top) + "px");
  });
});
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) e.target.classList.add("on"); }), { threshold: .12 });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
</script>
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
  const nm = ctx.from.first_name ? esc(ctx.from.first_name) : "друг";
  await ctx.reply(
    "🎄 <b>Привет, " + nm + "!</b>\n\n" +
    "Я — <b>Site-Maker</b>: соберу сайт для твоего бизнеса <b>за 1 минуту</b> и сразу дам рабочую ссылку 🌐\n\n" +
    "Магазин, барбершоп, кофейня, автосервис, салон — выбирай категорию ниже и отвечай на пару вопросов. Красивый дизайн, отзывы, кнопки звонка и WhatsApp — всё уже внутри.\n\n" +
    "🎁 <b>Новичок?</b> Жми «🎁 Премиум 5 мин» — попробуй максимум бесплатно прямо сейчас!\n" +
    "⭐ <b>Премиум</b>: 12 услуг с ценами, 8 отзывов, 8 FAQ и <b>без подписи бота</b> — твой сайт выглядит как у серьёзной компании. Подробности: /premium",
    { parse_mode: "HTML", reply_markup: backMenu() }
  );
});

bot.command("help", (ctx) => ctx.reply(
  "ℹ️ Как создать сайт:\n1️⃣ /start → категория\n2️⃣ Ответь на вопросы анкеты\n3️⃣ Получишь рабочую ссылку\n\n" +
  "⭐ /premium — тариф\n📊 /stats — статистика\n🔬 /diag — диагностика (админ)\n🔕 /notify on|off — уведомления админу\n👑 /give — выдать премиум (админ)"
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

const PREMIUM_TEXT =
  "⭐ <b>ПРЕМИУМ — " + PREMIUM_STARS + " ⭐ Stars</b>\n\n" +
  "Что входит:\n" +
  "🧾 До <b>12 услуг/товаров</b> <i>с ценами</i>\n" +
  "⭐ До <b>8 отзывов</b> и <b>8 вопросов-ответов</b>\n" +
  "🚫 <b>Без подписи бота</b> внизу — только твой бренд\n" +
  "💬 Кнопки звонка, WhatsApp, Telegram — клиенты пишут в 1 тап\n\n" +
  "Бесплатно: 4 услуги, 3 отзыва, 3 FAQ + подпись «Site-Maker» внизу.\n\n" +
  "💎 <b>С премиумом сайт выглядит как у компании, а не как визитка.</b>";

bot.command("premium", (ctx) => ctx.reply(PREMIUM_TEXT,
  { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("⭐ Купить за " + PREMIUM_STARS + " ⭐", "buy_premium") }
));

// ---------- /give: админ выдаёт премиум ----------
bot.command("give", (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply("Только для админа 🙂");
  const args = String(ctx.match || "").trim().split(/\s+/).filter(Boolean);
  if (!args.length) return ctx.reply("👑 Выдача премиума:\n\n/give <ID> — навсегда\n/give <ID> <минуты> — на время\n/give <ID> off — забрать\n/give list — кто в премиуме\n\nID можно узнать в @userinfobot");
  if (args[0].toLowerCase() === "list") {
    const rows = [...users.values()].filter((u) => u.premium)
      .map((u) => "• " + u.id + (u.id === ADMIN_ID ? " (ты)" : "") + " — " + (u.premiumUntil ? "до " + new Date(u.premiumUntil).toLocaleTimeString("ru-RU") : "навсегда"));
    return ctx.reply("⭐ Премиум:\n" + (rows.length ? rows.join("\n") : "никого"));
  }
  const id = Number(args[0]);
  if (!id) return ctx.reply("❌ Неверный ID. Это число, например: /give 123456789");
  if (args[1] && args[1].toLowerCase() === "off") {
    if (users.has(id)) {
      const u = users.get(id);
      u.premium = false;
      u.premiumUntil = 0;
      bot.api.sendMessage(id, "⭐ Премиум отключён.").catch(() => {});
    }
    return ctx.reply("✅ Премиум снят с " + id);
  }
  if (args[1] && !isNaN(Number(args[1]))) {
    const mins = Number(args[1]);
    grantPremium(id, mins * 60 * 1000, "⭐ Премиум активирован на " + mins + " мин! Спасибо 🎄");
    return ctx.reply("✅ Премиум выдан " + id + " на " + mins + " минут");
  }
  grantPremium(id, 0, "⭐ Премиум активирован НАВСЕГДА! Спасибо 🎄");
  ctx.reply("✅ Премиум выдан " + id + " навсегда");
});

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
    if (data === "trial") { await ctx.answerCallbackQuery(); return startTrial(ctx); }
    if (data === "help") { await ctx.answerCallbackQuery(); return ctx.reply("ℹ️ /start — меню, /premium — тариф"); }
    if (data === "stats") { await ctx.answerCallbackQuery(); return sendStats(ctx); }
    if (data === "premium") { await ctx.answerCallbackQuery(); return ctx.reply(PREMIUM_TEXT, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("⭐ Купить за " + PREMIUM_STARS + " ⭐", "buy_premium") }); }
    if (data === "buy_premium") {
      await ctx.answerCallbackQuery();
      return ctx.replyWithInvoice("⭐ Премиум Site-Maker", "Расширенный тариф: 12 услуг, цены, без подписи бота", "premium_" + ctx.from.id, "XTR", [{ label: PREMIUM_STARS + " ⭐", amount: PREMIUM_STARS }]);
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
  u.premiumUntil = 0;
  if (u.data) u.data.premium = true;
  await ctx.reply("⭐ Премиум активирован навсегда! Спасибо! 🎄");
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
