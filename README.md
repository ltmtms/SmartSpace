# SmartSpace

A web app where students and teachers build, program and explore their own interactive 3D worlds —
in the browser, in VR and in AR. Built on [three.js](https://threejs.org).

- **Build** – drag in shapes, 45 built-in characters / animals / buildings / nature / vehicles / game items,
  3D text, lights and sculptable terrain. Move, rotate and resize with gizmos. Import your own `.glb`, `.gltf`,
  `.obj`, `.stl`, pictures and sounds, or search free model libraries.
- **Program** – give any object behaviour with visual blocks (events, loops, if/else, variables, functions,
  motion, animation, physics, sound). Every block program converts to JavaScript and Python, and learners can
  switch an object to text code at any time.
- **Physics** – rigid-body simulation (Rapier): per-object physics on/off, gravity, mass, friction, bounciness,
  collision shape, collision layers and masks; world gravity presets.
- **Explore** – orbit, walk in first person (keyboard, touch joystick) or fly; VR headsets and AR through WebXR.
- **Together** – several people edit the same world live (objects, settings and code), with presence and
  per-user undo. Worlds are shared by link as view-only or editable.
- **Sign-in** – Google accounts only.

## Run it

Requires Node.js 20.11 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Until Google sign-in is configured, the development server shows a name-only
"dev login" so you can try everything locally. That login does not exist in production.

Production:

```bash
npm run build
GOOGLE_CLIENT_ID=... npm start
```

### Google sign-in

1. In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** of type *Web application*.
2. Add your site's origin (for example `https://smartspace.myschool.edu`, and `http://localhost:3000` for
   development) under **Authorized JavaScript origins**. No redirect URI is needed.
3. Start the server with `GOOGLE_CLIENT_ID` set to that client ID.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client ID. Required in production. |
| `ALLOWED_DOMAINS` | Optional comma-separated Google Workspace domains allowed to sign in (e.g. `myschool.edu`). |
| `GUEST_LOGIN` | `true` enables name-only sign-in on a deployed server while no `GOOGLE_CLIENT_ID` is set. Test deployments only: anyone who can reach the site can sign in under any name, including someone else's. |
| `GUEST_CODE` | Optional shared code required for guest sign-in. |
| `SESSION_SECRET` | Secret for signing session cookies. Generated and stored in the data folder if unset. |
| `PORT` | HTTP port (default 3000). |
| `DATA_DIR` | Where worlds, uploads and accounts are stored (default `./data`). Back this folder up. |
| `POLY_PIZZA_API_KEY` | Optional. Adds Poly Pizza results to model search (Poly Haven needs no key). |

Serve it over HTTPS in production: browsers only allow VR/AR, and Google sign-in, on secure origins.

## Deploy

SmartSpace is one long-running Node server (HTTP + WebSockets) that keeps its data in a folder, so it needs a
host that runs containers and offers a persistent disk. Static hosts (GitHub Pages, Netlify) and
serverless-function hosts will not work. Run a single instance: the collaboration server keeps open worlds in memory.

**Render** (uses `render.yaml`)

The blueprint is set up as a free **test deployment**: sign-in is name-only (no Google) and there is no
persistent disk, so worlds are wiped whenever the service restarts, redeploys or goes to sleep.

1. In Render choose **New → Blueprint** and pick this repository.
2. When asked for values, leave `GOOGLE_CLIENT_ID` and `ALLOWED_DOMAINS` empty. Optionally set `GUEST_CODE`
   to a code your testers must type to get in. Deploy, then open the `https://….onrender.com` URL.

To turn the test deployment into a real one:

1. Create the Google OAuth client (see *Google sign-in* above) with the site URL as an authorized JavaScript
   origin, and set `GOOGLE_CLIENT_ID` in the service's Environment tab. Guest sign-in switches off automatically.
2. Remove `GUEST_LOGIN`, change the plan to a paid instance type and enable the disk in `render.yaml`.

**GitHub Pages (browser-only demo)**

GitHub Pages can only serve static files, so it cannot run the SmartSpace server. The repository includes a
second build for it that needs no server: the editor, blocks, JavaScript, Python, physics, file import and
VR/AR all work, and worlds are saved in the visitor's own browser (IndexedDB) on that device.

Not available in the demo build: sign-in, sharing links, building together in real time, and model search.
Worlds do not follow a person to another browser or device, and clearing site data deletes them.

One-time setup: repository **Settings → Pages → Source: GitHub Actions**. After that,
`.github/workflows/pages.yml` publishes the demo to `https://<owner>.github.io/<repo>/` on every push to
`main` (or run it by hand from the Actions tab). To build it yourself:

```bash
npm run build:static -- --base=/SmartSpace/
```

**Any Docker host** (Railway, Fly.io, a school server)

```bash
docker build -t smartspace .
```

```bash
docker run -d --name smartspace -p 3000:3000 -v smartspace-data:/data -e GOOGLE_CLIENT_ID=your-client-id smartspace
```

For a test without Google sign-in, replace `-e GOOGLE_CLIENT_ID=…` with `-e GUEST_LOGIN=true`.

Put it behind HTTPS (the platform's own, or a reverse proxy such as Caddy that forwards WebSockets), mount a
volume at `/data`, and back that volume up.

## Devices

| Device | How |
| --- | --- |
| PC / Mac / Chromebook | Any current Chrome, Edge, Firefox or Safari. |
| Phones and tablets | Works in the mobile browser and installs as an app ("Add to Home Screen"). It is a web app (PWA), not an app-store app. |
| Meta Quest and other headsets | Open the site in the headset browser and press **VR**. Left stick moves, right stick turns, trigger clicks objects. |
| Cardboard | Android Chrome uses WebXR via the **VR** button. iPhones get a split-screen **Cardboard** mode driven by the gyroscope. |
| AR | Android Chrome (ARCore): press **AR**, point at a surface and tap to place the world as a table-top model. iOS Safari has no WebXR AR. |

## Scripting

Each object has one program: blocks, JavaScript or Python (the tabs in the code panel choose which one runs).
`me` is the object the script belongs to.

```js
when.start(() => me.say("Hi!"));
me.onClick(() => { me.push(0, 5, 0); world.playSound("jump"); });
me.onCollide((other) => { if (other.isPlayer) { world.changeVar("score", 1); me.destroy(); } });
when.key("space", () => me.moveBy(0, 1, 0));
when.update((dt) => { if (input.keyDown("right")) me.x += 3 * dt; });
when.every(2, async () => { await me.glideTo(0, 3, 0, 1); });
```

```python
@when_clicked
def clicked():
    me.push(0, 5, 0)
    world.play_sound("jump")

@when_collides
def bump(other):
    if other.isPlayer:
        me.destroy()

@every(2)
async def patrol():
    await me.glide_to(0, 3, 0, 1)
```

| Area | Commands |
| --- | --- |
| Events | `when.start`, `when.update(dt)`, `when.clicked`, `when.collides(other)`, `when.collisionEnds`, `when.key`, `when.keyReleased`, `when.every(seconds)`, `when.message` / `world.broadcast` |
| Motion | `me.x/y/z`, `moveBy`, `setPosition`, `moveForward`, `turn`, `rotateBy`, `setRotation`, `lookAt`, `glideTo`, `setScale`, `distanceTo` |
| Looks | `me.color`, `opacity`, `show()`, `hide()`, `say(text, seconds)`, `setText`, `world.showText`, `world.setSky` |
| Animation | `me.animate("spin" \| "bounce" \| "float" \| "pulse" \| "wobble", speed)`, or the name of an imported model's clip; `stopAnimation()` |
| Physics | `me.dynamic`, `gravity`, `solid`, `mass`, `friction`, `bounciness`, `push`, `setVelocity`, `setSpin`, `setCollision(layer, [layers])`, `isTouching`, `world.gravity` |
| Sound | `world.playSound(name)` – built-in `pop coin jump laser boom hit win lose click beep`, a frequency in Hz, or the name of an imported sound; `world.stopSounds()` |
| World | `world.find(name)`, `findAll`, `spawn(kind, x, y, z)`, `me.clone()`, `me.destroy()`, `world.vars` / `getVar` / `setVar` / `changeVar`, `world.time`, `player`, `wait(seconds)`, `print(...)` |

Python uses the same commands in `snake_case` and is run by Pyodide, which is served from this app
(about 13 MB, downloaded the first time a world uses Python).

## How it is put together

```
server/   Express API, Google sign-in, Yjs collaboration server (WebSocket), file store, model-search proxy
shared/   World data model, used by both server and client
src/
  engine/   three.js viewport + WebXR, object factory, asset library, terrain, physics, play-mode runtime, Python bridge
  editor/   Editor, scene sync, library, inspector, code panel, file import
  blocks/   Block definitions and the JavaScript / Python generators
  collab/   Client side of the shared document
  localStore.js  Browser storage used instead of the server by the static (GitHub Pages) build
  pages/    Sign-in and "My worlds"
```

A world is one [Yjs](https://yjs.dev) document (`objects`, `settings`, and a text per object per language).
The editor writes to the document and the 3D scene is rebuilt from it, so local edits and collaborators' edits
take the same path. Play mode runs against the live three.js objects and never writes to the document; pressing
Stop rebuilds the scene from the document. Imported 3D models are converted to a single `.glb` in the browser
before upload.

## Things to know before putting this in front of a class

- **Script safety.** Student code runs inside the page, not in a sandbox. Dangerous browser globals are hidden
  from scripts to prevent accidents, but a determined student could get around that, and code written by anyone
  who can edit a world runs in the browser of everyone who plays it. Only open worlds from people you trust,
  and keep "anyone with the link can build" for people in your class. Running the player in a sandboxed iframe
  on a separate origin is the proper fix.
- **Storage** is a JSON file plus files on disk in `DATA_DIR`: fine for a class or a school, single server only.
- **Walking on moving platforms.** The first-person walker can get stuck on an object while a script is moving
  it. Still objects and physics objects are fine.
- **Loops in text code.** Loops made from blocks cannot freeze the page; a `while (true) {}` typed in
  JavaScript or Python without a `wait` can.
- **Not yet tested on hardware / live services:** VR and AR sessions (no headset or ARCore device was available
  during development), a real Google sign-in round trip (needs your client ID), and the external model search
  providers.
- There are no classes, assignments or teacher dashboards; sharing is by link.

## Licences

Third-party runtime pieces: three.js (MIT), Rapier (Apache-2.0), Blockly (Apache-2.0), Yjs (MIT),
CodeMirror (MIT), Pyodide (MPL-2.0). The 3D text font is Droid Sans Bold (Apache-2.0).
