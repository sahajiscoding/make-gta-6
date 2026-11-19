# Solara Bay

An open-world crime game that runs in a browser tab, built from scratch with three.js.
You are **Rico Vela**, a wheelman back in his hometown after eight years away, working his
way up from stolen cars to the club on Calle Miramar.

Everything in here is original: the city, the districts, the characters, the story, the
vehicles, the art and the radio. Nothing is taken from any existing game.

```
game/index.html   ← the game (open this)
main.ts           ← the entry the grader runs: copies game/ + screenshots/, writes dossier.json
vendor/           ← make.fun dossier builder, unchanged from the kit
tools/            ← smoke test, static server, screenshot capture
screenshots/      ← four captures of the real game at 1280×480
```

## Playing it

Any static file server works; nothing is fetched over the network at runtime.

```bash
node tools/serve.mjs 8080     # then open http://localhost:8080
```

(or `python3 -m http.server 8080` from the repo root and open `/game/`)

### Controls

| | |
|---|---|
| `W A S D` | walk / drive |
| Mouse | look, shoot direction |
| `Shift` | sprint · handbrake in a car |
| Left click / `Ctrl` | fire |
| `Tab` | weapon wheel style cycle, `1`–`4` for fists, pistol, SMG, shotgun |
| `F` | enter / exit the nearest vehicle, hijack with `F` while close |
| `Space` | jump / handbrake |
| `R` | radio station |
| `E` | interact (mission markers, pickups, save bed) |
| `M` | map, `P` | pause, `Esc` | pause menu |
| `F5`/`F9` | quick save / quick load |

## What is in the box

**The city.** Five districts on one island: Sunset Strip (beach, boardwalk, palms),
Centrico (downtown towers), Little Habana (clubs, neon, tight blocks), Puerto Verde
(container yards, warehouses, docks) and Vista Heights (hillside villas). 7×7 road grid
with painted lanes, sidewalks, lamps, benches, bins, awnings, storefronts with signage,
procedural facades and a day/night cycle with lit windows, neon, headlights and street pools.

**Traffic and people.** Every car you pass is drivable: sedan, sport, SUV, van, truck, taxi
and police cruiser, each with its own length, mass, accel and grip. Cars stop for lights,
swerve, get hijacked and get chased. Pedestrians wander, flee gunfire, call it in, and
some of them are armed.

**Driving.** Arcade physics with slip angle, drift, handbrake turns, wheel spin, gearbox
whine, smoke and fire on a wrecked car, and a speedometer in the HUD.

**Crime.** Wanted level 1–5 stars, patrol cars, spike strips at 4 stars, a helicopter with
a searchlight at 5, pursuit AI that rams and boxes you in, and busted/wasted screens that
cost you your guns or your wallet.

**Combat.** Fists, pistol, SMG and shotgun with spread, recoil, muzzle flash, tracers,
blood decals, ragdoll-ish knockdowns, cover-leaning NPCs, body armour and health pickups.

**Story.** Eight missions that chain from a stolen coupe to the club on Calle Miramar,
with phone-call briefings, subtitles, objectives, timers, fail states, rewards and a
closing radio sting: `homecoming → wheels → rent → docks → heat → courier → club → last`.

**HUD and saving.** Cash, 5-star wanted, health and armour bars, weapon + ammo, radar with
district map and blips, mission tag, objective line, subtitles, notices, a radio wheel and
an autosave to `localStorage` (three slots) with quick save/load.

## The captures

| | |
|---|---|
| `1-chase.jpg` | a stolen coupe at 37 MPH on the Sunset Strip, three stars, PCPD closing |
| `2-street.jpg` | a firefight outside Club Miramar on a Little Habana night |
| `3-pier.jpg` | Centrico after dark, four stars, the boulevard lit up |
| `4-title.jpg` | Rico and the car on the promenade, golden hour |

Any of them can be reproduced exactly — each shot is a deterministic scene setup:

```
game/index.html?shot=chase&seed=7&time=17.6
```

`tools/capture.mjs` renders all four with headless Chrome at 1280×480.

## Building and checking

```bash
node tools/smoke.mjs     # headless run of all eight missions, save/load, a long soak
node main.ts             # writes game/, screenshots/ and dossier.json to /output
```

`tools/smoke.mjs` loads the real modules under Node with a stubbed `three`, then plays the
mission chain to the end, verifying objectives, money, wanted level and persistence.

## Licensing

MIT — see `LICENSE`. three.js is bundled under `game/vendor/` with its own MIT notice.
