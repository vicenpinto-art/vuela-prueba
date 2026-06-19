// ─────────────────────────────────────────────────────────────────────────────
//  nav.js  —  Barra de navegación compartida · Espacio Vuela
//  Uso: incluir <script src="nav.js"></script> en el <head> de cada página,
//       DESPUÉS del CDN de Supabase.
//  El nav se inyecta automáticamente al inicio del <body>.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const SUPA_URL = 'https://mcmdsntnbgsmdraeitgt.supabase.co';
  const SUPA_KEY = 'sb_publishable_dBivnUgV8EeaoSH9EJVQPQ_d692xRQq';

  // ── CSS ────────────────────────────────────────────────────────────────────
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600;700&family=Outfit:wght@300;400;500;600;700&display=swap');

    .ev-nav {
      position: sticky; top: 0; width: 100%; z-index: 200;
      padding: 0 40px;
      height: 64px;
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(255,255,255,0.97);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(0,0,0,0.08);
      box-sizing: border-box;
      font-family: 'Outfit', sans-serif;
      gap: 16px;
    }

    /* Logo */
    .ev-nav-logo-wrap { display:flex; align-items:center; text-decoration:none; flex-shrink:0; }
    .ev-nav-logo { height: 38px; display: block; }
    .ev-nav-logo-txt { display:none; font-family:'Dancing Script',cursive; font-size:26px; color:#ff4e68; }

    /* Links */
    .ev-nav-links {
      list-style: none; display: flex; align-items: center;
      gap: 4px; margin: 0; padding: 0; flex: 1; justify-content: center;
    }
    .ev-nav-links a {
      text-decoration: none; color: rgba(0,0,0,.6); font-size: 14px;
      font-weight: 500; padding: 6px 12px; border-radius: 8px;
      transition: color .2s, background .2s;
    }
    .ev-nav-links a:hover { color: #ff4e68; background: rgba(255,78,104,.06); }

    /* CTA */
    .ev-nav-cta {
      background: #ff4e68; color: #fff !important; padding: 9px 20px !important;
      border-radius: 100px; font-weight: 600 !important;
      transition: transform .2s, box-shadow .2s; white-space: nowrap;
    }
    .ev-nav-cta:hover {
      transform: translateY(-2px) !important;
      box-shadow: 0 8px 24px rgba(255,78,104,.4) !important;
      background: rgba(0,0,0,0) !important;
      background-color: #ff4e68 !important;
    }

    /* Área derecha */
    .ev-nav-right {
      display: flex; align-items: center; gap: 10px; flex-shrink: 0;
    }
    .ev-nav-rol {
      font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px;
      background: rgba(255,78,104,.1); color: #ff4e68;
      text-transform: uppercase; letter-spacing: 1px; white-space: nowrap;
    }
    .ev-nav-avatar {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: 50%;
      background: linear-gradient(135deg,#a183ff,#ff4e68);
      border: 2.5px solid rgba(255,255,255,0.85);
      text-decoration: none; cursor: pointer; flex-shrink: 0;
    }
    .ev-nav-avatar span { font-size:15px; font-weight:700; color:#fff; line-height:1; }
    .ev-nav-micuenta {
      font-size: 13px; color: #555; font-weight: 500; text-decoration: none;
      white-space: nowrap;
    }
    .ev-nav-micuenta:hover { color: #ff4e68; }
    .ev-nav-salir {
      background: none; border: none; font-family: 'Outfit', sans-serif;
      font-size: 13px; color: #aaa; cursor: pointer; padding: 0; font-weight: 500;
    }
    .ev-nav-salir:hover { color: #ff4e68; }

    /* Móvil */
    .ev-nav-mobile-right {
      display: none; align-items: center; gap: 8px;
    }
    .ev-nav-menu-btn {
      background: none; border: 1.5px solid rgba(0,0,0,.15);
      border-radius: 8px; padding: 6px 10px; cursor: pointer;
      font-size: 18px; color: #333; line-height: 1;
    }

    @media (max-width: 768px) {
      .ev-nav {
        padding: 0 16px; height: auto;
        min-height: 56px; flex-wrap: wrap; gap: 0;
      }
      .ev-nav-logo { height: 32px; }

      /* Links se ocultan, se muestran al abrir */
      .ev-nav-links {
        display: none; flex-direction: column; width: 100%;
        padding: 6px 0 8px; gap: 0;
        border-top: 1px solid rgba(0,0,0,.07);
        margin-top: 4px; order: 3; justify-content: flex-start;
      }
      .ev-nav-links.nav-open { display: flex !important; }
      .ev-nav-links li { display: block; width: 100%; }
      .ev-nav-links a {
        display: block; padding: 11px 16px; font-size: 15px;
        border-radius: 0; border-bottom: 1px solid rgba(0,0,0,.05);
      }
      .ev-nav-links li:last-child a,
      .ev-nav-links li:last-child button { border-bottom: none; }
      .ev-nav-links .ev-nav-cta {
        margin: 8px 16px; display: block; text-align: center;
        border-radius: 100px !important;
      }
      .ev-nav-links button.ev-nav-salir {
        display: block; padding: 11px 16px; font-size: 14px;
        text-align: left; width: 100%;
      }

      /* Área derecha se oculta en desktop-modo */
      .ev-nav-right { display: none; }
      .ev-nav-mobile-right { display: flex; }
    }
  `;

  // ── HTML ───────────────────────────────────────────────────────────────────
  // El área derecha (.ev-nav-right) y el avatar móvil se rellenan por JS
  // según el estado de sesión.
  const HTML = `
    <a href="index.html" class="ev-nav-logo-wrap">
      <img src="images/logo.png" alt="Espacio Vuela" class="ev-nav-logo"
           onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">
      <span class="ev-nav-logo-txt">Espacio Vuela</span>
    </a>

    <ul class="ev-nav-links" id="ev-nav-links">
      <li><a href="index.html">Inicio</a></li>
      <li><a href="index.html#clases">Clases</a></li>
      <li><a href="planes.html">Planes</a></li>
      <li><a href="profes.html">Profes</a></li>
      <li id="ev-li-micuenta"><a href="mi-cuenta.html">Mi cuenta</a></li>
      <li><a href="javascript:void(0)" onclick="abrirIGVuela()" class="ev-nav-cta">Súmate a Vuela</a></li>
      <li id="ev-li-salir" style="display:none">
        <button class="ev-nav-salir" id="btn-salir-nav">Salir</button>
      </li>
    </ul>

    <!-- Desktop derecha: avatar + rol + "Mi cuenta" + Salir -->
    <div class="ev-nav-right" id="ev-nav-right"></div>

    <!-- Móvil: avatar pequeño + hamburguesa -->
    <div class="ev-nav-mobile-right">
      <div id="ev-nav-mobile-avatar"></div>
      <button class="ev-nav-menu-btn" id="ev-nav-hamburger">☰</button>
    </div>
  `;

  // ── INYECTAR ───────────────────────────────────────────────────────────────
  function inject() {
    // CSS
    const styleEl = document.createElement('style');
    styleEl.id = 'ev-nav-style';
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    // Nav element
    const nav = document.createElement('nav');
    nav.className = 'ev-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Navegación principal');
    nav.innerHTML = HTML;

    // Insertar al inicio del body
    document.body.insertBefore(nav, document.body.firstChild);

    // Hamburguesa
    document.getElementById('ev-nav-hamburger').addEventListener('click', function () {
      document.getElementById('ev-nav-links').classList.toggle('nav-open');
    });

    // Cerrar menú al hacer clic en un link
    document.getElementById('ev-nav-links').addEventListener('click', function (e) {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') {
        document.getElementById('ev-nav-links').classList.remove('nav-open');
      }
    });

    // Auth
    _initAuth();
  }

  // ── AUTH ───────────────────────────────────────────────────────────────────
  async function _initAuth() {
    if (typeof supabase === 'undefined') return;

    const sb = supabase.createClient(SUPA_URL, SUPA_KEY);
    let session;
    try {
      const res = await sb.auth.getSession();
      session = res.data.session;
    } catch (e) { return; }

    if (!session) return;

    let u = null;
    try {
      const res = await sb.from('usuarios')
        .select('nombre, rol')
        .eq('id', session.user.id)
        .single();
      u = res.data;
    } catch (e) {}

    const nombre  = (u && u.nombre) ? u.nombre : '';
    const rol     = (u && u.rol)    ? u.rol    : 'alumna';
    const inicial = (nombre[0] || '?').toUpperCase();
    const href    = rol === 'admin'     ? 'admin.html'
                  : rol === 'profesora' ? 'mi-cuenta.html'
                  :                       'mi-cuenta.html';

    // -- Ocultar "Mi cuenta" del menú (reemplazado por avatar desktop)
    const liMiCuenta = document.getElementById('ev-li-micuenta');
    if (liMiCuenta) liMiCuenta.style.display = 'none';

    // -- Mostrar "Salir" en el menú móvil
    const liSalir = document.getElementById('ev-li-salir');
    if (liSalir) liSalir.style.display = '';

    // -- Badge de rol
    const rolBadge = (rol === 'admin')
      ? '<span class="ev-nav-rol">Admin</span>'
      : (rol === 'profesora')
        ? '<span class="ev-nav-rol">Profesora</span>'
        : '';

    // -- Desktop derecha: RolBadge + Avatar + "Mi cuenta" + Salir
    const rightEl = document.getElementById('ev-nav-right');
    if (rightEl) {
      rightEl.innerHTML = `
        ${rolBadge}
        <a href="${href}" class="ev-nav-avatar" title="Ir a mi cuenta">
          <span>${inicial}</span>
        </a>
        <a href="${href}" class="ev-nav-micuenta">Mi cuenta</a>
        <button class="ev-nav-salir" id="btn-salir-desktop">Salir</button>
      `;
      document.getElementById('btn-salir-desktop').addEventListener('click', _salir.bind(null, sb));
    }

    // -- Móvil: avatar pequeño
    const mobileAvatarEl = document.getElementById('ev-nav-mobile-avatar');
    if (mobileAvatarEl) {
      mobileAvatarEl.innerHTML = `
        <a href="${href}" class="ev-nav-avatar" title="${nombre}" style="width:32px;height:32px;">
          <span style="font-size:13px">${inicial}</span>
        </a>
      `;
    }

    // -- Logout desde menú móvil
    const btnSalirNav = document.getElementById('btn-salir-nav');
    if (btnSalirNav) btnSalirNav.addEventListener('click', _salir.bind(null, sb));
  }

  async function _salir(sb) {
    await sb.auth.signOut();
    window.location.href = 'login.html';
  }

  // ── INSTAGRAM ──────────────────────────────────────────────────────────────
  // Definida globalmente para compatibilidad con llamadas existentes en páginas
  window.abrirIGVuela = window.evNavIG = function () {
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      window.location = 'instagram://user?username=espacio_vuela';
      setTimeout(function () {
        window.location = 'https://www.instagram.com/espacio_vuela/';
      }, 1500);
    } else {
      window.open('https://ig.me/m/espacio_vuela', '_blank');
    }
  };

  // ── INIT ───────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

})();
