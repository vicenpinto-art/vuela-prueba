import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
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
  // Buscar el link "Mi cuenta" en el nav y reemplazarlo
  const navLink = document.querySelector('nav ul a[href="login.html"]');
  if (!navLink) return;

  if (user) {
    // Cargar foto desde Firestore
    const snap = await getDoc(doc(db, 'usuarios', user.uid));
    const data = snap.exists() ? snap.data() : {};
    const foto = data.foto || user.photoURL || null;
    const name = data.nombre || user.displayName || user.email.split('@')[0];

    // Crear el avatar
    const avatar = document.createElement('a');
    avatar.href  = 'login.html';
    avatar.title = name;
    avatar.style.cssText = `
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px; height: 36px;
      border-radius: 50%;
      overflow: hidden;
      background: linear-gradient(135deg, #a183ff, #ff4e68);
      font-family: 'Outfit', sans-serif;
      font-size: 15px; font-weight: 700;
      color: #fff;
      text-decoration: none;
      flex-shrink: 0;
      border: 2px solid rgba(255,255,255,0.8);
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      transition: transform 0.2s, box-shadow 0.2s;
    `;
    avatar.onmouseenter = () => { avatar.style.transform = 'scale(1.08)'; avatar.style.boxShadow = '0 4px 16px rgba(161,131,255,0.4)'; };
    avatar.onmouseleave = () => { avatar.style.transform = 'scale(1)';    avatar.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'; };

    if (foto) {
      const img = document.createElement('img');
      img.src = foto;
      img.style.cssText = 'width:100%; height:100%; object-fit:cover; border-radius:50%;';
      avatar.appendChild(img);
    } else {
      avatar.textContent = name[0].toUpperCase();
    }

    // Reemplazar el li que contiene el link
    navLink.parentElement.replaceWith((() => {
      const li = document.createElement('li');
      li.appendChild(avatar);
      return li;
    })());

  } else {
    // No hay sesión: mostrar "Mi cuenta" normal
    navLink.textContent = 'Mi cuenta';
  }
});
