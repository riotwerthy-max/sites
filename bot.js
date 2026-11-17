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
  const c = Object.assign({}, CATS[catKey] || CATS.visitka);

  if (prem && themeKey && THEMES[themeKey]) {
    Object.assign(c, THEMES[themeKey]);
  }

  const contact = d.contact || "";
  const services = parseServices(d.services, catKey);

  const items = services.map((s, i) => `
    <article class="service-card reveal" style="--delay:${i * 90}ms">
      <div class="service-icon">${c.icon}</div>
      <div class="service-number">${String(i + 1).padStart(2, "0")}</div>
      <h3>${esc(s.name)}</h3>
      ${s.price ? `<div class="price">${esc(s.price)}</div>` : ""}
      <p>Качественно, быстро и с вниманием к деталям.</p>
      <div class="card-line"></div>
    </article>
  `).join("");

  const faq = [
    ["Как заказать?", "Нажмите любую кнопку связи и напишите нам. Мы быстро ответим и уточним детали."],
    ["Сколько это стоит?", "Цена зависит от задачи. Итоговую стоимость сообщим до начала работы, без скрытых доплат."],
    ["Есть ли гарантия?", "Да. Мы отвечаем за результат и всегда стараемся решить вопрос до конца."],
  ].map(([question, answer], i) => `
    <details class="faq reveal" style="--delay:${i * 90}ms">
      <summary>${esc(question)} <span>＋</span></summary>
      <p>${esc(answer)}</p>
    </details>
  `).join("");

  const reviews = parseReviews(d.reviews).map((r, i) => `
    <article class="review-card reveal" style="--delay:${i * 100}ms">
      <div class="review-top">
        <div class="avatar">${esc((r[0] || "А").slice(0, 1).toUpperCase())}</div>
        <div>
          <strong>${esc(r[0])}</strong>
          <div class="stars">★★★★★</div>
        </div>
      </div>
      <p>«${esc(r[1])}»</p>
    </article>
  `).join("");

  const watermark = prem ? "" : `
    <div class="watermark">
      🎁 <a href="https://t.me/${esc(config.BOT_USERNAME || "sitemaket_bot")}">
        Сделано в @${esc(config.BOT_USERNAME || "sitemaket_bot")}
      </a>
    </div>
  `;

  const badge = prem
    ? `<div class="badge premium-badge">⭐ PREMIUM</div>`
    : `<div class="badge">${c.icon} ${esc(c.name)}</div>`;

  const heroStyle = prem && d.photo && /^https?:\/\//i.test(d.photo)
    ? `background-image:linear-gradient(180deg,rgba(5,8,20,.25),rgba(5,8,20,.96)),url('${esc(d.photo)}')`
    : "";

  const safeName = esc(d.name || "Мой проект");
  const safeSubtitle = esc(d.subtitle || "Красивый сайт для вашего проекта");
  const safeContact = esc(contact || "Свяжитесь с нами");

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="#071225">
  <meta name="description" content="${safeSubtitle}">
  <title>${safeName}</title>

  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${c.icon}</text></svg>">

  <style>
    :root {
      --primary: ${c.g1};
      --secondary: ${c.g2};
      --accent: ${c.accent};
      --bg: #050914;
      --panel: rgba(13, 24, 48, .72);
      --text: #f4f7ff;
      --muted: #a9b9d8;
      --border: rgba(255,255,255,.13);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }

    body {
      min-height: 100vh;
      overflow-x: hidden;
      color: var(--text);
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.65;
      background:
        radial-gradient(circle at 15% 10%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 28%),
        radial-gradient(circle at 85% 20%, color-mix(in srgb, var(--secondary) 22%, transparent), transparent 30%),
        linear-gradient(145deg, #030610 0%, #0a142a 48%, #050914 100%);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      opacity: .22;
      background-image:
        linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(to bottom, black, transparent 80%);
    }

    .page { position: relative; z-index: 1; }

    .snow-layer,
    .snow-layer::before,
    .snow-layer::after {
      position: fixed;
      inset: -20px 0 0;
      pointer-events: none;
      z-index: 20;
      background-image:
        radial-gradient(3px 3px at 20px 30px, #fff, transparent),
        radial-gradient(2px 2px at 90px 80px, #fff, transparent),
        radial-gradient(3px 3px at 170px 140px, #d9f4ff, transparent),
        radial-gradient(2px 2px at 260px 40px, #fff, transparent),
        radial-gradient(3px 3px at 340px 190px, #d9f4ff, transparent),
        radial-gradient(2px 2px at 460px 100px, #fff, transparent);
      background-size: 520px 260px;
      animation: snowfall 16s linear infinite;
      opacity: .7;
    }

    .snow-layer::before {
      content: "";
      animation-duration: 25s;
      animation-delay: -8s;
      transform: scale(1.35);
      opacity: .45;
    }

    .snow-layer::after {
      content: "";
      animation-duration: 32s;
      animation-delay: -15s;
      transform: scale(.8);
      opacity: .3;
    }

    @keyframes snowfall {
      from { transform: translate3d(0, -260px, 0); }
      to { transform: translate3d(100px, 100vh, 0); }
    }

    .top-garland {
      height: 30px;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 50;
      display: flex;
      justify-content: space-around;
      align-items: flex-start;
      padding: 4px 8%;
      background: rgba(3, 7, 18, .72);
      border-bottom: 1px solid rgba(255,255,255,.08);
      backdrop-filter: blur(14px);
    }

    .bulb {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--bulb);
      box-shadow: 0 0 12px var(--bulb), 0 0 24px var(--bulb);
      animation: blink 1.8s infinite ease-in-out;
      animation-delay: var(--blink-delay);
    }

    @keyframes blink {
      0%, 100% { opacity: .42; transform: scale(.8); }
      50% { opacity: 1; transform: scale(1.25); }
    }

    nav {
      position: sticky;
      top: 30px;
      z-index: 40;
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
      padding: 14px 18px;
      background: rgba(5, 9, 20, .72);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(18px);
    }

    nav a {
      color: #dbe7ff;
      text-decoration: none;
      font-size: .86rem;
      padding: 7px 14px;
      border: 1px solid var(--border);
      border-radius: 999px;
      transition: .25s ease;
    }

    nav a:hover {
      color: #fff;
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      transform: translateY(-2px);
    }

    .wrap {
      width: min(1120px, calc(100% - 32px));
      margin: auto;
    }

    .hero {
      position: relative;
      min-height: 570px;
      display: grid;
      place-items: center;
      text-align: center;
      overflow: hidden;
      margin-top: 28px;
      padding: 90px 24px 76px;
      border: 1px solid var(--border);
      border-radius: 34px;
      background: ${heroStyle || "linear-gradient(135deg, rgba(12,24,52,.9), rgba(8,13,31,.76))"};
      background-size: cover;
      background-position: center;
      box-shadow: 0 30px 90px rgba(0,0,0,.36), inset 0 0 80px rgba(255,255,255,.035);
    }

    .hero::before,
    .hero::after {
      content: "";
      position: absolute;
      border-radius: 50%;
      filter: blur(4px);
      pointer-events: none;
    }

    .hero::before {
      width: 340px;
      height: 340px;
      top: -170px;
      left: -100px;
      background: color-mix(in srgb, var(--primary) 28%, transparent);
      animation: float 7s ease-in-out infinite;
    }

    .hero::after {
      width: 300px;
      height: 300px;
      right: -100px;
      bottom: -150px;
      background: color-mix(in srgb, var(--secondary) 28%, transparent);
      animation: float 9s ease-in-out infinite reverse;
    }

    @keyframes float {
      0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
      50% { transform: translate3d(20px, 18px, 0) scale(1.08); }
    }

    .hero-content { position: relative; z-index: 2; max-width: 780px; }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 24px;
      padding: 9px 18px;
      color: var(--accent);
      font-size: .86rem;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
      border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
      border-radius: 999px;
      background: rgba(255,255,255,.07);
      box-shadow: 0 0 28px color-mix(in srgb, var(--accent) 18%, transparent);
    }

    .premium-badge {
      color: #ffe08a;
      border-color: rgba(255, 214, 87, .65);
      box-shadow: 0 0 30px rgba(255, 196, 56, .24);
    }

    .hero h1 {
      font-size: clamp(2.4rem, 8vw, 5.4rem);
      line-height: 1.04;
      letter-spacing: -.06em;
      background: linear-gradient(100deg, #fff, var(--accent), #fff, var(--secondary));
      background-size: 300% auto;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: gradientMove 6s linear infinite;
    }

    @keyframes gradientMove { to { background-position: 300% center; } }

    .hero .sub {
      max-width: 650px;
      margin: 22px auto 0;
      color: var(--muted);
      font-size: clamp(1rem, 2.2vw, 1.3rem);
    }

    .hero-actions {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 32px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 190px;
      padding: 15px 24px;
      color: #07101f;
      font-weight: 900;
      text-decoration: none;
      border-radius: 999px;
      background: linear-gradient(110deg, var(--primary), var(--accent), var(--secondary));
      background-size: 220% auto;
      box-shadow: 0 12px 32px color-mix(in srgb, var(--primary) 28%, transparent);
      transition: .3s ease;
      animation: buttonGradient 5s linear infinite;
    }

    .btn:hover {
      transform: translateY(-4px) scale(1.03);
      box-shadow: 0 18px 44px color-mix(in srgb, var(--accent) 34%, transparent);
    }

    .btn.secondary {
      color: #eaf1ff;
      border: 1px solid var(--border);
      background: rgba(255,255,255,.07);
      box-shadow: none;
      animation: none;
    }

    @keyframes buttonGradient { to { background-position: 220% center; } }

    .section { margin: 90px 0; scroll-margin-top: 100px; }
    .section-title { margin-bottom: 30px; text-align: center; }
    .section-title small { color: var(--accent); font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .section-title h2 { margin-top: 7px; font-size: clamp(1.8rem, 4vw, 2.7rem); }

    .services-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 18px;
    }

    .service-card,
    .review-card,
    .about-card,
    .faq {
      border: 1px solid var(--border);
      background: linear-gradient(145deg, rgba(255,255,255,.09), rgba(255,255,255,.035));
      box-shadow: 0 18px 50px rgba(0,0,0,.2);
      backdrop-filter: blur(12px);
    }

    .service-card {
      position: relative;
      min-height: 235px;
      overflow: hidden;
      padding: 26px;
      border-radius: 24px;
      transition: .35s ease;
    }

    .service-card:hover {
      transform: translateY(-9px) rotateX(2deg);
      border-color: var(--accent);
      box-shadow: 0 22px 55px color-mix(in srgb, var(--accent) 18%, transparent);
    }

    .service-icon {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      margin-bottom: 18px;
      border-radius: 17px;
      font-size: 1.5rem;
      background: linear-gradient(135deg, var(--primary), var(--secondary));
      box-shadow: 0 10px 26px color-mix(in srgb, var(--primary) 28%, transparent);
    }

    .service-number {
      position: absolute;
      top: 18px;
      right: 22px;
      color: rgba(255,255,255,.28);
      font-size: 1.5rem;
      font-weight: 900;
    }

    .service-card h3 { font-size: 1.22rem; }
    .service-card p { margin-top: 10px; color: var(--muted); }
    .price { margin-top: 5px; color: var(--accent); font-weight: 900; }
    .card-line { width: 58px; height: 3px; margin-top: 22px; border-radius: 9px; background: linear-gradient(90deg, var(--primary), var(--accent)); }

    .about-card {
      padding: clamp(26px, 5vw, 52px);
      text-align: center;
      border-radius: 28px;
      color: #dce7fb;
      font-size: 1.1rem;
    }

    .review-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 18px;
    }

    .review-card { padding: 24px; border-radius: 22px; }
    .review-top { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
    .avatar { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; color: #07101f; font-size: 1.25rem; font-weight: 900; background: linear-gradient(135deg, var(--primary), var(--accent)); }
    .stars { color: #ffd45c; letter-spacing: 2px; font-size: .82rem; }
    .review-card p { color: var(--muted); }

    .faq { margin: 12px 0; padding: 20px 22px; border-radius: 18px; transition: .25s; }
    .faq:hover { border-color: var(--accent); }
    .faq summary { display: flex; justify-content: space-between; cursor: pointer; list-style: none; font-weight: 800; }
    .faq summary::-webkit-details-marker { display: none; }
    .faq summary span { color: var(--accent); font-size: 1.3rem; transition: .25s; }
    .faq[open] summary span { transform: rotate(45deg); }
    .faq p { margin-top: 14px; color: var(--muted); }

    .contact-card { text-align: center; }
    .contact-value { margin-top: 14px; color: var(--accent); font-size: 1.15rem; font-weight: 900; word-break: break-word; }

    footer {
      position: relative;
      z-index: 1;
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 10px;
      padding: 34px 16px 46px;
      color: #9eafd0;
      font-size: .9rem;
    }

    footer span { padding: 8px 14px; border: 1px solid var(--border); border-radius: 999px; background: rgba(255,255,255,.04); }

    .watermark {
      position: fixed;
      left: 14px;
      bottom: 14px;
      z-index: 60;
      padding: 8px 14px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(3,7,18,.82);
      font-size: .78rem;
      backdrop-filter: blur(12px);
    }

    .watermark a { color: var(--accent); text-decoration: none; }

    .reveal {
      opacity: 0;
      transform: translateY(28px);
      transition: opacity .7s ease var(--delay), transform .7s ease var(--delay);
    }

    .reveal.show { opacity: 1; transform: none; }

    @media (max-width: 600px) {
      .wrap { width: min(100% - 20px, 1120px); }
      .hero { min-height: 520px; padding: 70px 16px 55px; border-radius: 25px; }
      nav { padding: 10px 8px; gap: 5px; }
      nav a { padding: 6px 9px; font-size: .76rem; }
      .section { margin: 65px 0; }
      .btn { width: 100%; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: .01ms !important;
      }
    }
  </style>
</head>
<body>
  <div class="snow-layer"></div>

  <div class="top-garland">
    <i class="bulb" style="--bulb:#ff4d6d;--blink-delay:0s"></i>
    <i class="bulb" style="--bulb:#ffe066;--blink-delay:.25s"></i>
    <i class="bulb" style="--bulb:#4dabf7;--blink-delay:.5s"></i>
    <i class="bulb" style="--bulb:#69db7c;--blink-delay:.75s"></i>
    <i class="bulb" style="--bulb:#da77f2;--blink-delay:1s"></i>
    <i class="bulb" style="--bulb:#ff922b;--blink-delay:1.25s"></i>
    <i class="bulb" style="--bulb:#ff4d6d;--blink-delay:1.5s"></i>
  </div>

  <div class="page">
    <nav>
      <a href="#about">О нас</a>
      <a href="#services">Услуги</a>
      <a href="#reviews">Отзывы</a>
      <a href="#faq">Вопросы</a>
      <a href="#contacts">Контакты</a>
    </nav>

    <main class="wrap">
      <section class="hero">
        <div class="hero-content">
          ${badge}
          <h1>${safeName}</h1>
          <p class="sub">${safeSubtitle}</p>
          <div class="hero-actions">
            <a class="btn" href="${linkify(contact)}">${c.icon} Заказать сейчас</a>
            <a class="btn secondary" href="#services">Посмотреть услуги</a>
          </div>
        </div>
      </section>

      <section class="section" id="about">
        <div class="section-title">
          <small>✨ Добро пожаловать</small>
          <h2>Создаём результат, которым хочется делиться</h2>
        </div>
        <div class="about-card reveal">
          ${safeSubtitle}. Мы работаем быстро, честно и всегда остаёмся на связи — даже в праздники.
        </div>
      </section>

      <section class="section" id="services">
        <div class="section-title">
          <small>${c.icon} Наши возможности</small>
          <h2>Что мы предлагаем</h2>
        </div>
        <div class="services-grid">${items}</div>
      </section>

      <section class="section" id="reviews">
        <div class="section-title">
          <small>💬 Отзывы клиентов</small>
          <h2>Нам доверяют</h2>
        </div>
        <div class="review-grid">${reviews}</div>
      </section>

      <section class="section" id="faq">
        <div class="section-title">
          <small>❄️ Частые вопросы</small>
          <h2>Всё самое важное</h2>
        </div>
        ${faq}
      </section>

      <section class="section" id="contacts">
        <div class="section-title">
          <small>🎁 Свяжитесь с нами</small>
          <h2>Начнём прямо сейчас?</h2>
        </div>
        <div class="about-card contact-card reveal">
          Напишите нам — ответим быстро и обсудим вашу задачу.
          <div class="contact-value">${safeContact}</div>
          <a class="btn" href="${linkify(contact)}">🎄 Написать нам</a>
        </div>
      </section>
    </main>

    ${watermark}

    <footer>
      <span>🔒 Безопасно</span>
      <span>⚡ Быстрый ответ</span>
      <span>🛡 Надёжный сервис</span>
      <span>🎄 Новогоднее настроение</span>
    </footer>
  </div>

  <script>
    (function () {
      const elements = document.querySelectorAll('.reveal');

      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('show');
              observer.unobserve(entry.target);
            }
          });
        }, { threshold: 0.12 });

        elements.forEach(function (element) {
          observer.observe(element);
        });
      } else {
        elements.forEach(function (element) {
          element.classList.add('show');
        });
      }
    })();
  </script>
</body>
</html>`;
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
