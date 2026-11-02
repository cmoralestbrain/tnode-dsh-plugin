# @tnode/dsh-plugin

Plugin de DeepSeek Harness para operar tus TNodes desde la sidebar derecha:
lista nodos, abre un chat owner y transmite la respuesta por SSE.

Incluye:

- **Host Cordis**: arranca `tnode bridge` en `127.0.0.1:3987`.
- **Panel cliente** (`dsh.client`): tab TNode en `sidebar.right.pane.tab`.
- **Bundle patch** (`cordis.patch.yml`): el plugin manager lo instala y activa sin
  editar YAML a mano.

## Instalación como usuario

En DSH, abre **Settings → Plugins** e instala el bundle desde GitHub:

```text
github:cmoralestbrain/tnode-dsh-plugin
```

También puedes usar el tarball del release `v0.1.0`. Actívalo; si el perfil no
tiene HMR, reinicia DSH.

El paquete es **autocontenido**: incluye el runtime del puente en `lib/cli/`, así
que no necesita publicar `@tnode/cli` ni resolver dependencias externas.

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
3. Token: contenido de `~/.config/tnode/bridge-token`.
4. Elige TSporty (OpenClaw) y chatea.

El token se guarda en `localStorage` del origen del harness; no se envía al nodo.
Mr. Monkey (Pi) también funciona: el bridge usa el gateway subset con sesión owner `tnode-mobile-*`.

## Publicación

1. `npm run build` en el CLI y `npm run sync:dsh` (copia `dist/src/lib` a `lib/cli`).
2. `npm pack` y verifica `lib/index.js`, `lib/client.js`, `lib/cli/*.js`,
   `cordis.patch.yml` y `README.md`.
3. `npm publish --access public`.
4. Instala desde DSH Plugins por nombre/versión.

El plugin manager valida `engines.dsh`; si tu DSH es anterior, ajusta la versión.
