# @tnode/dsh-plugin

Plugin de DeepSeek Harness para operar tus TNodes desde la sidebar derecha:
lista nodos, abre un chat owner y transmite la respuesta por SSE.

Incluye:

- **Host Cordis**: arranca `tnode bridge` en `127.0.0.1:3987`.
- **Panel cliente** (`dsh.client`): tab TNode en `sidebar.right.pane.tab`.
- **Bundle patch** (`cordis.patch.yml`): el plugin manager lo instala y activa sin
  editar YAML a mano.

## Instalación como usuario

En DSH, abre **Settings → Plugins** e instala el bundle desde npm o GitHub:

```text
@tnode/dsh-plugin
```

o el spec que corresponda (`github:usuario/repo`, tarball). Actívalo; si el perfil
no tiene HMR, reinicia DSH.

El paquete es **autocontenido**: incluye el runtime del puente en `lib/cli/`, así que
no necesita publicar `@tnode/cli` ni resolver dependencias externas.

## Instalación local (desarrollo)

En `~/.dsh/profiles/desktop/package.json`:

```json
{
  "dependencies": {
    "@tnode/dsh-plugin": "file:/Users/tobal/Documents/deepseek-harness/default-workspace/tnode/packages/dsh-tnode"
  }
}
```

En `dsh.profile.bundles`, agrega `@tnode/dsh-plugin`. Luego:

```bash
cd ~/.dsh/profiles/desktop
pnpm install   # o npm install
```

Reinicia DSH. El bundle aporta su propio `cordis.patch.yml`; no agregues la fila
`tnode-bridge` a mano.

## Uso

1. Abre la sidebar derecha → **TNode** (tarjeta del guide o tab).
2. URL: `http://127.0.0.1:3987`.
3. El panel se autentica por **origen local** (`127.0.0.1`/`localhost`), sin copiar token.
   Sin sesión: **“Conectar con Google”** (OAuth host) o **“Vincular con código”**
   (device flow: la app → Tu → Conectar harness). Muestra QR local y el código manual.
   La sesión QR se guarda en `~/.config/tnode/harness.json` (0600) y respeta los
   nodos aprobados. **Desconectar harness** borra esa sesión, limpia el panel y
   revoca el device en CF si está disponible.
4. Elige entorno (`beta`/`prod`) y nodo.
5. El panel carga el historial de sesiones desde Firestore; `+` crea una nueva.
6. El punto verde indica el bridge; `↻` reconecta/refresca.

El token de `~/.config/tnode/bridge-token` sigue disponible para CLI/curl, pero el
panel DSH no lo pide. Mr. Monkey (Pi) también funciona: el bridge usa el gateway subset
con sesión owner `tnode-mobile-*`.

> Seguridad MVP: el bridge confía en orígenes loopback cuando lo arranca el plugin.
> Fase 2 lo sustituye por device authorization/QR con scopes.

## Publicación

1. `npm run build` en el CLI y `npm run sync:dsh` (copia `dist/src/lib` a `lib/cli`).
2. `npm pack` y verifica `lib/index.js`, `lib/client.js`, `lib/cli/*.js`,
   `cordis.patch.yml` y `README.md`.
3. `npm publish --access public`.
4. Instala desde DSH Plugins por nombre/versión.

El plugin manager valida `engines.dsh`; si tu DSH es anterior, ajusta la versión.
