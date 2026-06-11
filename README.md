# Crimson Labyrinth

An original retro 3D browser shooter built from scratch with HTML, CSS, and
vanilla JavaScript. It uses a classic raycast renderer to create a fast,
pixelated 3D maze with enemies, pickups, combat, keys, locked doors, an exit
gate, HUD, minimap, procedural sound effects, enemy projectiles, and
mouse/keyboard controls.

This project is Doom-inspired in genre and feel, but it does not copy Doom's
assets, maps, names, enemy designs, code, or copyrighted presentation.

## Run

Open `index.html` in a modern browser, or serve the folder locally:

```sh
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Controls

- `W A S D` or arrow keys: move
- Mouse or left/right arrows: turn
- Space or click: fire
- `E`: open doors, unlock seals, activate exit
- `M`: toggle minimap
- `P`: pause

## Gameplay notes

- Runner enemies close distance quickly and attack up close.
- Sentinel and brute enemies can hold range and fire plasma bolts.
- Audio is generated with the Web Audio API after the first user interaction,
  so no external sound assets are required.

## Verification

Run a JavaScript syntax check:

```sh
node --check assets/script.js
```
