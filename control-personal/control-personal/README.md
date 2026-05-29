# 📋 Control de Personal — Guía de instalación

Sistema web de control de entradas/salidas con Firebase + Netlify.

---

## 🔧 Paso 1: Crear proyecto en Firebase

1. Ve a [console.firebase.google.com](https://console.firebase.google.com)
2. Clic en **"Agregar proyecto"**, ponle un nombre (ej: `control-personal`)
3. Desactiva Google Analytics si no lo necesitas → **Crear proyecto**

---

## 🔐 Paso 2: Configurar Authentication

1. En el menú izquierdo: **Build → Authentication**
2. Clic en **"Comenzar"**
3. Pestaña **"Sign-in method"** → habilitar **Correo electrónico/contraseña**
4. Guardar

---

## 🗄️ Paso 3: Configurar Firestore

1. En el menú izquierdo: **Build → Firestore Database**
2. Clic en **"Crear base de datos"**
3. Selecciona **"Comenzar en modo de producción"** → Siguiente
4. Elige la región más cercana (ej: `nam5` para América) → **Habilitar**

### Aplicar las reglas de seguridad:
1. En Firestore → pestaña **"Reglas"**
2. Borra el contenido actual y pega el contenido del archivo `firestore.rules`
3. Clic en **"Publicar"**

---

## ⚙️ Paso 4: Obtener credenciales

1. En Firebase Console → ícono de engranaje ⚙️ → **"Configuración del proyecto"**
2. Baja hasta **"Tus apps"** → clic en **"</>"** (Web)
3. Registra la app con un nombre (ej: `control-web`) → **Registrar app**
4. Copia el objeto `firebaseConfig` que aparece

---

## 📝 Paso 5: Editar el archivo de configuración

Abre el archivo `js/firebase-config.js` y reemplaza los valores:

```javascript
const firebaseConfig = {
  apiKey:            "AIzaSy...",           // ← Tu apiKey
  authDomain:        "tu-proyecto.firebaseapp.com",
  projectId:         "tu-proyecto",          // ← Tu projectId
  storageBucket:     "tu-proyecto.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abc..."
};
```

---

## 🚀 Paso 6: Subir a Netlify

### Opción A — Drag & Drop (más fácil):
1. Ve a [app.netlify.com](https://app.netlify.com)
2. Inicia sesión o crea cuenta gratuita
3. En el dashboard: **"Add new site" → "Deploy manually"**
4. **Arrastra y suelta la carpeta `control-personal`** completa al área indicada
5. Netlify desplegará tu sitio en segundos y te dará una URL

### Opción B — GitHub (recomendado para actualizaciones):
1. Sube la carpeta a un repositorio de GitHub
2. En Netlify: **"Add new site" → "Import an existing project"**
3. Conecta con GitHub y selecciona el repositorio
4. Configuración de build:
   - **Base directory**: (vacío)
   - **Build command**: (vacío)
   - **Publish directory**: `.`
5. Clic en **"Deploy site"**

---

## 👤 Paso 7: Crear cuenta admin

Al entrar al sistema por primera vez:
- El sistema intenta crear automáticamente el admin con:
  - **Email**: `admin@sistema.com`
  - **Contraseña**: `admin123`
- Si falla, puedes crearlo manualmente en Firebase Console:
  1. **Authentication → Users → Agregar usuario**
  2. Email: `admin@sistema.com`, Contraseña: `admin123`
  3. Copia el UID que aparece
  4. **Firestore → users → Agregar documento** con ese UID como ID:
     ```
     nombre: "Administrador"
     apellido: ""
     email: "admin@sistema.com"
     role: "admin"
     ```

> ⚠️ **Importante**: Cambia la contraseña del admin después de la primera entrada.

---

## 📁 Estructura del proyecto

```
control-personal/
├── index.html              # App principal
├── netlify.toml            # Config Netlify
├── firestore.rules         # Reglas de seguridad
├── css/
│   └── style.css           # Estilos
└── js/
    ├── firebase-config.js  # ← EDITAR con tus credenciales
    ├── app.js              # Entry point
    ├── auth.js             # Login / registro / logout
    ├── worker.js           # Panel empleada
    ├── admin.js            # Panel administrador
    └── pdf.js              # Generación de reportes
```

---

## 🆓 Costos

- **Firebase Spark (gratuito)**: 1GB Firestore, 50K lecturas/día, 20K escrituras/día — más que suficiente para equipos pequeños
- **Netlify Free**: 100GB ancho de banda/mes, despliegues ilimitados

---

## ❓ Soporte

Si encuentras algún problema, revisa la consola del navegador (F12) para ver mensajes de error de Firebase.
