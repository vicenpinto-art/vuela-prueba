import { initializeApp }             from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCE3qm-Fs0hPM_D56K-UlZ9Ka4cXwikA3Q",
  authDomain:        "espacio-vuela-91a84.firebaseapp.com",
  projectId:         "espacio-vuela-91a84",
  storageBucket:     "espacio-vuela-91a84.firebasestorage.app",
  messagingSenderId: "515497928481",
  appId:             "1:515497928481:web:627883d783124ea1f00060",
  measurementId:     "G-K1H2LQYDH5"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

onAuthStateChanged(auth, async (user) => {
  // Buscar el <li> que contiene el link a login.html
  const allLinks = document.querySelectorAll('nav ul li a');
  let navLi = null;
  for (const link of allLinks) {
    if (link.getAttribute('href') === 'login.html') {
      navLi = link.parentElement;
      break;
    }
  }
  if (!navLi) return;

  if (user) {
    // Cargar datos desde Firestore
    let foto = user.photoURL || null;
    let name = user.displayName || user.email.split('@')[0];
    try {
      const snap = await getDoc(doc(db, 'usuarios', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        if (d.foto)   foto = d.foto;
        if (d.nombre) name = d.nombre;
      }
    } catch(e) { /* si falla Firestore igual mostramos avatar básico */ }

    // Construir avatar
    const a = document.createElement('a');
    a.href  = 'login.html';
    a.title = name;
    a.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'width:36px',
      'height:36px',
      'border-radius:50%',
      'overflow:hidden',
      'background:linear-gradient(135deg,#a183ff,#ff4e68)',
      'font-family:Outfit,sans-serif',
      'font-size:15px',
      'font-weight:700',
      'color:#fff',
      'text-decoration:none',
      'flex-shrink:0',
      'border:2.5px solid rgba(255,255,255,0.85)',
      'box-shadow:0 2px 10px rgba(161,131,255,0.35)',
      'transition:transform .2s,box-shadow .2s',
      'cursor:pointer'
    ].join(';');

    a.addEventListener('mouseenter', () => {
      a.style.transform  = 'scale(1.1)';
      a.style.boxShadow  = '0 4px 18px rgba(161,131,255,0.5)';
    });
    a.addEventListener('mouseleave', () => {
      a.style.transform  = 'scale(1)';
      a.style.boxShadow  = '0 2px 10px rgba(161,131,255,0.35)';
    });

    if (foto) {
      const img = document.createElement('img');
      img.src = foto;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
      img.onerror = () => { a.innerHTML = ''; a.textContent = name[0].toUpperCase(); };
      a.appendChild(img);
    } else {
      a.textContent = name[0].toUpperCase();
    }

    navLi.innerHTML = '';
    navLi.appendChild(a);

  } else {
    // Sin sesión: restaurar texto normal
    navLi.innerHTML = '<a href="login.html" style="text-decoration:none;color:rgba(0,0,0,0.6);font-size:14px;font-weight:500;">Mi cuenta</a>';
  }
});
