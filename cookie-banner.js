/**
 * cookie-banner.js — Espacio Vuela
 * Muestra banner de consentimiento de cookies.
 * Carga Google Analytics solo si el usuario acepta.
 *
 * Uso en cada HTML, antes de </head>:
 *   <script>window.EV_GA = 'G-K1H2LQYDH5';</script>
 *   <script src="cookie-banner.js"></script>
 */

(function () {
  const STORAGE_KEY = 'ev_cookies_consent'; // 'accepted' | 'rejected'
  const GA_ID       = window.EV_GA || 'G-K1H2LQYDH5';
  const consent     = localStorage.getItem(STORAGE_KEY);

  /* ── Si ya aceptó: carga GA inmediatamente ── */
  if (consent === 'accepted') {
    loadGA();
    return;
  }

  /* ── Si ya rechazó: no hace nada ── */
  if (consent === 'rejected') return;

  /* ── Sin decisión: esperar DOM e inyectar banner ── */
  document.addEventListener('DOMContentLoaded', injectBanner);

  /* ════════════════════════════════════════════════ */

  function loadGA() {
    const s  = document.createElement('script');
    s.async  = true;
    s.src    = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID);
  }

  function accept() {
    localStorage.setItem(STORAGE_KEY, 'accepted');
    loadGA();
    remove();
  }

  function reject() {
    localStorage.setItem(STORAGE_KEY, 'rejected');
    remove();
  }

  function remove() {
    const el = document.getElementById('ev-cookie-banner');
    if (el) {
      el.style.transform  = 'translateY(120%)';
      el.style.opacity    = '0';
      setTimeout(() => el.remove(), 400);
    }
  }

  function injectBanner() {
    /* ── Estilos ── */
    const style = document.createElement('style');
    style.textContent = `
      #ev-cookie-banner {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(0);
        width: calc(100% - 48px);
        max-width: 680px;
        background: #fff;
        border: 1px solid rgba(0,0,0,.1);
        border-radius: 20px;
        box-shadow: 0 8px 40px rgba(0,0,0,.12);
        padding: 20px 24px;
        display: flex;
        align-items: center;
        gap: 20px;
        z-index: 99999;
        font-family: 'Outfit', sans-serif;
        transition: transform .4s ease, opacity .4s ease;
      }
      #ev-cookie-banner .ev-cb-icon {
        font-size: 28px;
        flex-shrink: 0;
        line-height: 1;
      }
      #ev-cookie-banner .ev-cb-text {
        flex: 1;
        min-width: 0;
      }
      #ev-cookie-banner .ev-cb-text p {
        font-size: 13px;
        color: #555;
        line-height: 1.55;
        margin: 0;
      }
      #ev-cookie-banner .ev-cb-text a {
        color: #a183ff;
        text-decoration: underline;
        font-size: 12px;
      }
      #ev-cookie-banner .ev-cb-btns {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }
      #ev-cookie-banner .ev-cb-accept {
        padding: 10px 20px;
        background: #ff4e68;
        color: #fff;
        border: none;
        border-radius: 100px;
        font-family: 'Outfit', sans-serif;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: opacity .2s;
        white-space: nowrap;
      }
      #ev-cookie-banner .ev-cb-accept:hover { opacity: .85; }
      #ev-cookie-banner .ev-cb-reject {
        padding: 10px 16px;
        background: none;
        color: #888;
        border: 1.5px solid rgba(0,0,0,.12);
        border-radius: 100px;
        font-family: 'Outfit', sans-serif;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: border-color .2s, color .2s;
        white-space: nowrap;
      }
      #ev-cookie-banner .ev-cb-reject:hover {
        border-color: #888;
        color: #333;
      }
      @media (max-width: 560px) {
        #ev-cookie-banner {
          flex-direction: column;
          align-items: flex-start;
          gap: 14px;
          bottom: 16px;
          width: calc(100% - 32px);
        }
        #ev-cookie-banner .ev-cb-btns {
          width: 100%;
        }
        #ev-cookie-banner .ev-cb-accept,
        #ev-cookie-banner .ev-cb-reject {
          flex: 1;
          text-align: center;
        }
      }
    `;
    document.head.appendChild(style);

    /* ── HTML del banner ── */
    const banner = document.createElement('div');
    banner.id    = 'ev-cookie-banner';
    banner.innerHTML = `
      <div class="ev-cb-icon">🍪</div>
      <div class="ev-cb-text">
        <p>Usamos cookies para mejorar tu experiencia. <a href="privacidad.html">Más información</a></p>
      </div>
      <div class="ev-cb-btns">
        <button class="ev-cb-reject" id="ev-cb-reject-btn">Rechazar</button>
        <button class="ev-cb-accept" id="ev-cb-accept-btn">Aceptar</button>
      </div>
    `;

    document.body.appendChild(banner);

    document.getElementById('ev-cb-accept-btn').addEventListener('click', accept);
    document.getElementById('ev-cb-reject-btn').addEventListener('click', reject);
  }

})();
