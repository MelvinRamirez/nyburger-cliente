# nyburger-cliente

PWA del comensal para New York Burger: menú, carrito y envío de pedidos desde el celular, usando el código QR de cada mesa. Sitio estático puro (sin framework, sin bundler), publicado por GitHub Pages.

El backend (Google Apps Script) vive en el repositorio privado [`MelvinRamirez/NYBurger`](https://github.com/MelvinRamirez/NYBurger). Este repositorio no duplica ningún archivo de ese backend; solo consume sus endpoints HTTP documentados en `openspec/specs/{menu-api,order-api,api-transport}/spec.md` de ese repo.

## Desarrollo local

Requiere Node.js >= 22.

```bash
npm test
```

Para emular el sub-path de GitHub Pages en desarrollo local:

```bash
# desde el directorio padre de nyburger-cliente
python3 -m http.server 8000
# abrir http://localhost:8000/nyburger-cliente/?table=05
```

## Tailwind CSS

El CSS se genera una vez con el CLI standalone de Tailwind v4 y se commitea (no hay build en el deploy). Binario fijado para este proyecto:

- Versión: **v4.3.3**
- Binario: `tailwindcss-macos-x64` (ajustar a la arquitectura de quien regenere el CSS)
- Descarga:

```bash
mkdir -p bin
curl -sSLo bin/tailwindcss https://github.com/tailwindlabs/tailwindcss/releases/download/v4.3.3/tailwindcss-macos-x64
chmod +x bin/tailwindcss
```

Regenerar el CSS tras cambiar clases en `index.html` o `js/`:

```bash
npm run build:css
```

## Deploy

**Sitio publicado**: https://melvinramirez.github.io/nyburger-cliente/

- **Hosting**: GitHub Pages, "Deploy from a branch" → `main` / `(root)`. Sin build step: los archivos se sirven tal como están commiteados.
- **QR por mesa**: cada mesa codifica `https://melvinramirez.github.io/nyburger-cliente/?table=NN` (ej. `?table=05`). Si falta el parámetro `table`, la PWA pide la mesa con un modal manual.
- **`js/config.js`**: contiene la URL real de producción del Web App de Apps Script (`API_URL`). Si el backend se re-despliega con una nueva URL `/exec`, hay que actualizar esa constante acá y volver a publicar.

### Bump de versión de caché

El service worker (`sw.js`) precachea el app shell con un nombre de caché versionado (`CACHE_VERSION`, actualmente `foodc-shell-v3`). **En cada deploy que cambie HTML, CSS, JS, el manifest o los íconos**, hay que incrementar ese valor (ej. `foodc-shell-v4`) antes de pushear — si no se bumpea, los clientes que ya instalaron la PWA siguen sirviendo el shell viejo desde caché indefinidamente.

```js
// sw.js
const CACHE_VERSION = 'foodc-shell-v3'; // ← incrementar en cada deploy del shell
```

Las llamadas a la API (`script.google.com` / `script.googleusercontent.com`) nunca se cachean — siempre van a la red, así que no requieren ningún bump.
