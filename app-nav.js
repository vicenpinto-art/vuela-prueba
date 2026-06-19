/**
 * app-nav.js — Nav compartido para Espacio Vuela (sistema Supabase)
 *
 * USO EN CADA PÁGINA:
 *   1. Cargar Supabase CDN ANTES de este script:
 *      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *      <script src="app-nav.js"></script>
 *   2. Eliminar el bloque <nav>...</nav> existente de la página
 *   3. Eliminar la función abrirIGVuela() si existía
 *   4. Eliminar el event listener de btn-salir-nav si existía
 *      (este archivo lo maneja)
 *
 * RESULTADO:
 *   - Sin sesión:  Inicio · Clases · Profes · [Súmate a Vuela] · Mi cuenta
 *   - Con sesión:  Inicio · Clases · Profes · [Súmate a Vuela] · [Avatar/Rol] · Salir
 */

(async () => {

  // ── CONFIG ──────────────────────────────────────────────────────
  const SUPABASE_URL = 'https://mcmdsntnbgsmdraeitgt.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_dBivnUgV8EeaoSH9EJVQPQ_d692xRQq';

  // ── CSS ──────────────────────────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `
    /* ── NAV BASE ── */
    #ev-nav {
      position: sticky; top: 0; width: 100%; z-index: 200;
      padding: 10px 40px;
      display: flex; align-items: center;
      background: rgba(255,255,255,0.96);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(0,0,0,0.08);
      box-sizing: border-box;
    }

    /* Logo */
    .ev-nav-logo     { height: 38px; display: block; flex-shrink: 0; text-decoration: none; }
    .ev-nav-logo img { height: 38px; display: block; }
    .ev-nav-logo-txt { display: none; font-family:'Dancing Script',cursive; font-size:26px; color:#ff4e68; }

    /* Links — margin-left:auto los empuja a la derecha */
    .ev-nav-links {
      list-style: none; display: flex; gap: 24px;
      align-items: center; margin: 0 0 0 auto; padding: 0;
    }
    .ev-nav-links a {
      text-decoration: none; color: rgba(0,0,0,.6);
      font-size: 14px; font-weight: 500;
      font-family: 'Outfit', sans-serif;
      transition: color .2s;
    }
    .ev-nav-links a:hover { color: #ff4e68; }

    /* CTA */
    .ev-nav-cta {
      background: #ff4e68; color: #fff !important;
      padding: 9px 20px; border-radius: 100px;
      font-weight: 600 !important; white-space: nowrap;
      transition: transform .2s, box-shadow .2s;
    }
    .ev-nav-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(255,78,104,.4); }

    /* ── SECCIÓN USUARIO (desktop) ── */
    .ev-nav-user {
      display: none; align-items: center; gap: 14px; margin-left: 16px;
    }
    .ev-nav-user.visible { display: flex; }

    /* Avatar + rol */
    .ev-nav-avatar-wrap {
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      text-decoration: none; cursor: pointer;
    }
    .ev-nav-avatar-circle {
      width: 34px; height: 34px; border-radius: 50%;
      background: linear-gradient(135deg, #a183ff, #ff4e68);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; color: #fff;
      flex-shrink: 0; overflow: hidden;
      transition: transform .2s, box-shadow .2s;
    }
    .ev-nav-avatar-wrap:hover .ev-nav-avatar-circle {
      transform: scale(1.08);
      box-shadow: 0 4px 14px rgba(161,131,255,.4);
    }
    .ev-nav-avatar-circle img { width: 100%; height: 100%; object-fit: cover; display: block; }

    .ev-nav-rol-txt {
      font-size: 9px; font-weight: 800;
      text-transform: uppercase; letter-spacing: 1px;
      font-family: 'Outfit', sans-serif; line-height: 1;
    }
    .ev-nav-rol-txt.admin     { color: #6b3fd4; }
    .ev-nav-rol-txt.profesora { color: #007a82; }
    .ev-nav-rol-txt.alumna    { color: #ff4e68; }

    /* Botón Salir */
    .ev-nav-salir {
      background: none; border: none;
      font-family: 'Outfit', sans-serif;
      font-size: 13px; color: #aaa; cursor: pointer;
      padding: 0; font-weight: 500;
      transition: color .2s;
    }
    .ev-nav-salir:hover { color: #ff4e68; }

    /* ── HAMBURGUESA (mobile) ── */
    .ev-nav-mobile { display: none; align-items: center; gap: 10px; margin-left: auto; }
    .ev-nav-menu-btn {
      background: none; border: 1.5px solid rgba(0,0,0,.15);
      border-radius: 8px; padding: 6px 10px;
      cursor: pointer; font-size: 18px; color: #333; line-height: 1;
    }

    /* ── RESPONSIVE ── */
    @media (max-width: 768px) {
      #ev-nav { padding: 12px 16px; flex-wrap: wrap; }

      .ev-nav-links {
        display: none; flex-direction: column;
        width: 100%; padding: 8px 0; gap: 0;
        border-top: 1px solid rgba(0,0,0,.08);
        margin-top: 8px; order: 3; margin-left: 0;
      }
      .ev-nav-links.nav-open { display: flex !important; }
      .ev-nav-links li { display: block; }
      .ev-nav-links a {
        display: block; padding: 12px 16px; font-size: 15px;
        border-bottom: 1px solid rgba(0,0,0,.05); color: rgba(0,0,0,.7);
      }
      .ev-nav-links li:last-child a,
      .ev-nav-links li:last-child button { border-bottom: none; }
      .ev-nav-links li button.ev-nav-salir {
        display: block; padding: 12px 16px; font-size: 15px;
        width: 100%; text-align: left; color: rgba(0,0,0,.7);
      }

      .ev-nav-logo img { height: 32px; }
      .ev-nav-mobile { display: flex; }
      .ev-nav-user   { display: none !important; }
    }
  `;
  document.head.appendChild(css);

  // ── HTML ──────────────────────────────────────────────────────────
  const nav = document.createElement('nav');
  nav.id = 'ev-nav';
  nav.innerHTML = `
    <a href="index.html" class="ev-nav-logo">
      <img src="images/logo.png" alt="Espacio Vuela"
           onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<span class=\\'ev-nav-logo-txt\\'>Espacio Vuela</span>')">
    </a>

    <ul class="ev-nav-links" id="ev-nav-links">
      <li><a href="index.html">Inicio</a></li>
      <li><a href="index.html#clases">Clases</a></li>
      <li><a href="profes.html">Profes</a></li>
      <li id="ev-li-micuenta"><a href="login.html">Mi cuenta</a></li>
      <li><a href="planes.html" class="ev-nav-cta">Súmate a Vuela</a></li>
      <li id="ev-li-salir-mobile" style="display:none">
        <button class="ev-nav-salir" onclick="document.getElementById('btn-salir-nav').click()">Salir</button>
      </li>
    </ul>

    <div class="ev-nav-user" id="ev-nav-user">
      <a href="mi-cuenta.html" class="ev-nav-avatar-wrap" id="ev-nav-avatar-wrap">
        <div class="ev-nav-avatar-circle" id="ev-nav-avatar-circle">?</div>
        <span class="ev-nav-rol-txt" id="ev-nav-rol-txt"></span>
      </a>
      <button class="ev-nav-salir" id="btn-salir-nav">Salir</button>
    </div>

    <div class="ev-nav-mobile">
      <button class="ev-nav-menu-btn"
              onclick="document.getElementById('ev-nav-links').classList.toggle('nav-open')">☰</button>
    </div>
  `;

  // Insertar al inicio del body
  document.body.insertBefore(nav, document.body.firstChild);

  // ── ESPERAR SUPABASE ──────────────────────────────────────────────
  await new Promise(resolve => {
    if (window.supabase) return resolve();
    const t = setInterval(() => { if (window.supabase) { clearInterval(t); resolve(); } }, 30);
    setTimeout(resolve, 3000); // timeout de seguridad
  });

  if (!window.supabase) return;

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Exponer cliente para que las páginas puedan reusarlo si quieren
  window.evSb = sb;

  // ── AUTH STATE ────────────────────────────────────────────────────
  const { data: { session } } = await sb.auth.getSession();

  if (!session) return; // Sin sesión: nav público, ya está bien

  // ── CON SESIÓN ────────────────────────────────────────────────────

  // Ocultar "Mi cuenta" (reemplazado por el avatar)
  const liMicuenta = document.getElementById('ev-li-micuenta');
  if (liMicuenta) liMicuenta.style.display = 'none';

  // Mostrar Salir en hamburguesa (mobile)
  const liSalirMobile = document.getElementById('ev-li-salir-mobile');
  if (liSalirMobile) liSalirMobile.style.display = 'block';

  // Obtener datos del usuario
  const { data: u } = await sb
    .from('usuarios')
    .select('nombre, rol')
    .eq('id', session.user.id)
    .maybeSingle();

  if (u) {
    // Inicial del avatar
    const circle = document.getElementById('ev-nav-avatar-circle');
    if (circle) circle.textContent = (u.nombre || '?')[0].toUpperCase();

    // Rol debajo del avatar
    const rolEl = document.getElementById('ev-nav-rol-txt');
    if (rolEl) {
      const labels = { admin: 'Admin', profesora: 'Profe', alumna: 'Alumna' };
      rolEl.textContent = labels[u.rol] || u.rol;
      rolEl.className   = `ev-nav-rol-txt ${u.rol || 'alumna'}`;
    }

    // Redirigir avatar click según rol
    const avatarWrap = document.getElementById('ev-nav-avatar-wrap');
    if (avatarWrap) {
      if (u.rol === 'admin')     avatarWrap.href = 'admin.html';
      else if (u.rol === 'profesora') avatarWrap.href = 'profesora.html';
      else                             avatarWrap.href = 'mi-cuenta.html';
    }
  }

  // Mostrar sección usuario
  const userSection = document.getElementById('ev-nav-user');
  if (userSection) userSection.classList.add('visible');

  // Botón Salir
  document.getElementById('btn-salir-nav')?.addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'login.html';
  });

})();
