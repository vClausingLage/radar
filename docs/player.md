# Player Guide

## What this game is

You command a single ship carrying a simulated airborne **fire-control radar**.
The radar is not a magic "see everything" sensor — it has to *sweep* a cone in
front of you, build **tracks** from the noisy returns it gets off enemy hulls,
and hold a target steady enough to guide a missile onto it. Flying well means
managing where your radar is looking, which mode it is in, and which weapon
suits the situation.

The map also contains other ships (targets) and solid terrain: drifting
asteroids, and in the campaign the ground, the launchpad and the dish radar
station's rock and tower. Terrain and ships both reflect your radar beam, so
clutter and real contacts share the same screen — part of the challenge is
telling tracks apart — and terrain is solid: fly into it and you are gone (see
*Landing and collisions*).

---

## A 60-second intro to the radar

- Your radar paints a **cone** ahead of the ship. Contacts only update while
  they are inside that cone, so you must point the ship to keep a target
  illuminated.
- The radar runs in one of three **modes**:
  - **RWS** — wide search. Finds contacts but doesn't commit to any.
  - **TWS** — track-while-scan. Holds up to **3** tracks and can launch the
    fire-and-forget **VIM-220**.
  - **STT** — single-target track. Locks one contact and pours the beam into it.
    Required to guide the **VIM-177**.
- Tracks are drawn as boxes with a little velocity line. In STT the locked
  track turns **red**.
- A **Radar Warning Receiver (RWR)** in the bottom-left shows when something is
  painting *you*, and from which bearing — green for search, red for a lock.
  A **red triangle with a number** is a missile: **22** is a VIM-220's own
  seeker, at the missile; **7** is a lock that is guiding a VIM-177, at the
  shooter (the VIM-177 itself emits nothing).

See [radar.md](radar.md) for how the simulation actually works under the hood.

---

## Keyboard & mouse

| Input | Action |
|-------|--------|
| **A / D** | Turn left / right |
| **W / S** | Throttle one setting up / down: REV → 1/3 → 2/3 → FULL |
| **R** | Switch to **RWS** (search) |
| **X** | Step the radar mode: RWS → TWS → IRST → EMCON → RWS (from STT: break the lock, back to RWS) |
| **F** | Pick the next track outward from you (a white bracket on the scope). **E** and a TWS shot go to the pick first |
| **E** | Lock. In RWS/TWS: enter **STT** on the picked track, or else the best current track. In **IRST** mode: lock the IRST onto the heat source nearest your nose |
| **Esc** | Break the lock: STT back to RWS; in IRST mode, drop the IRST lock |
| **Q** | Cycle active weapon (VIM-177 → VIM-220 → VIM-90) |
| **Space** | Fire the active weapon |
| **T** | Deploy a decoy (chaff) |
| **J** | Activate the jammer (10 s burst, 20 s cooldown) |
| **I** | Interrogate (IFF) every track on the scope - needs at least one track |
| **Shift + Click** | Place a VIM-220 mid-course waypoint (VIM-220 selected) |
| **Mouse + / −** buttons | Zoom the camera |
| **B** | Show the briefing again (it stays up for 25 s at the start) |
| **C** | Campaign: bogey dope call to Disco |
| **M** | Back to the menu: any time in free play and One versus Two, after the verdict in the campaign |

## Gamepad / Steam Deck

| Input | Action |
|-------|--------|
| **Left stick** | Turn left / right, proportional to deflection |
| **A** | Fire the active weapon |
| **B** | Lock: **STT** on the best current track, or the IRST lock in IRST mode |
| **X** | Deploy a decoy (chaff) |
| **Y** | Activate the jammer |
| **R1** | Step the radar mode: RWS → TWS → IRST → EMCON → RWS. From STT: break the lock, back to RWS |
| **L1** | Throttle one setting up: REV → 1/3 → 2/3 → FULL |
| **L2** | Throttle one setting down: FULL → 2/3 → 1/3 → REV |
| **D-pad left** | Cycle active weapon |
| **D-pad up** | Interrogate (IFF) |
| **D-pad right** | Pick the next track outward from you |
| **D-pad down** | Campaign: bogey dope call to Disco |
| **Start** | Cold start: throw the next switch. Campaign, after the verdict: next mission / retry |
| **Select** | Back to the menu: any time in free play and One versus Two, after the verdict in the campaign |
| **D-pad up/down or stick, then A** | In the menu: move the cursor and press. The first press only shows the cursor |

The zoom buttons stay on the touchscreen. The throttle is locked until the cold
start is complete, on the pad as on the touch buttons. VIM-220 waypoints need
Shift + click and have no gamepad or touch input.

The R1 loop has a cost: EMCON shuts the transmitter and drops every track, so
stepping from TWS back round to RWS passes through it and loses the picture. RWS
to TWS keeps the tracks.

The browser only reveals a gamepad to the page once a button has been pressed
with the page open, so press one if the first input seems to do nothing. Browsers
may also withhold gamepads from a page not served over https or localhost.

### Desktop build (Steam Deck)

`pnpm desktop` runs the game in its own window; `pnpm desktop:build` writes an
AppImage to `desktop/release/`. It is the same game as the website, wrapped in
Electron, and its menu adds a **QUIT** item.

On the Deck: copy the AppImage over and mark it executable (Properties →
Permissions), add it in Steam through *Games → Add a Non-Steam Game*, then in
Gaming Mode set its controller layout to a gamepad template. If the window stays
blank, add `--no-sandbox` to its launch options.

**IFF.** With at least one track held, `IFF [I]` shows beside the range readout.
Press **I** and every track is asked who it is; a track that answers turns blue
with a ring (friendly), one that does not gets an amber frame (unknown - treat as
hostile). Your side is code 0, the enemy's 1, and a transponder only answers its
own side's question. It reaches further than the range ring, but gas weakens it,
the answer fades after about 8 s, and a friend flying inside an enemy's track
makes the whole track read friendly. IFF never stops you firing - it is your
call. (The story levels have no IFF.)

**TWS** has no key binding — use its on-screen button. On-screen buttons next to
the ship mirror the mode and fire controls, and the speed buttons (1/3, 2/3,
FULL, REV) set throttle — REV is slow astern, the landing setting.

## Landing and collisions

Terrain is solid. What happens when your hull meets it depends on how fast you
are going and how you arrive:

- **Fast** (above the touchdown limit, roughly 2/3 throttle and up): a crash,
  whatever you hit.
- **Slow into a rock or the dish tower**: you just fetch up against it and
  stop. Back off and go round.
- **Slow onto ground** (the launchpad, the surface): a **landing** only if you
  come in **tail first** — nose pointing away from the surface, backing onto it
  at REV, within about 30° of straight back, the way a rocket sets down on its
  engines. Nose or side first is a crash even at a crawl.

So a pad approach is: line up nose-out, select **REV**, and let the ship back
down onto the pad. On touchdown the throttle drops to zero; select 1/3 to lift
off again. Missiles fly over ground and are stopped only by rocks and towers.

## Decoys (chaff)

You carry **5** decoys. Press **T** to drop a chaff cloud just astern of
your ship. A cloud lingers for a few seconds and fades out. A cloud is a
**volume of dipoles**, not a wall: it echoes energy of its own, and it lets
most of the beam through, so the radar hears both the cloud and your hull
behind or inside it. Which one it believes is a matter of **energy**:

- The cloud's echo grows with range (the radar's resolution cell widens the
  further out it looks, so more dipoles share it), your hull's does not. Far
  out the cloud outshines you; close in you outshine the cloud. That is the
  **burn-through range**.
- An **STT lock** follows the energy in its gate. Drop chaff while a lock is on
  you from far away and the gate walks off your hull onto the cloud as you
  fly clear of it. Close in, the lock burns through and stays on you.
- A **search radar** filters out echoes that do not move (rocks, gas,
  chaff — see *Notching* below), so in RWS/TWS the cloud itself rarely shows,
  but it does make the place it sits a clutter cell.

## Notching (beaming)

Every echo carries the reflector's speed along the line of sight (its
Doppler). Where a search radar knows there is clutter — rocks, gas, a chaff
cloud — it switches in a filter that throws away everything with **no radial
speed**, because that is what clutter looks like. Fly **square across the
threat's line of sight** (put it on your wingline) while you are among rocks,
gas or your own chaff, and your echo sits in that notch and fades from its
search picture. In clear space the filter is not in, so beaming alone does
nothing; and a close enough radar still burns through the notch. An STT lock
does not use the filter.

## Jammer (active deception)

Press **J** to fire up the jammer for **10 seconds**; it then needs **20 seconds**
(from the moment you switched it on) before it can run again. While active, a
translucent red wedge shows the **jamming cone** — a 20° arc straight ahead of
your ship, out to radar range.

Any enemy radar that **paints your ship while sitting inside that cone** gets
fooled: instead of seeing you where you are, its search/track modes (RWS/TWS)
build a **false contact** offset from your real position by a random bearing and
range. Your real return vanishes and the ghost takes its place, so the enemy
chases a target that isn't there.

A few things to keep in mind:

- **Point the cone at the threat.** The jammer only works against radars in the
  20° arc in front of you — turn to keep the threat boxed in.
- **It won't fake an STT lock.** A radar that has already locked you (pouring all
  its energy into one beam) is too strong to spoof — but jamming can still
  *flicker* the return and, with luck, **break the lock**. Combine it with chaff
  (**T**) for the best chance.
- **Mind the cooldown.** Ten seconds on, then a forced wait — don't waste a burst
  before the threat is actually looking at you.

---

## How to engage a target

### With the VIM-177 (SARH — needs a lock)
1. In **RWS** (press **R**), point the ship so the contact is inside the cone
   and let a stable track form.
2. Press **E** to go **STT** — the radar locks the strongest track and the box
   turns red.
3. Make sure **VIM-177** is the active weapon (press **Q** to cycle).
4. Press **Space**. The missile flies straight off the rail, then steers onto
   the intercept.
5. **Keep the lock** — keep the target in your cone. If the lock breaks the
   missile loses guidance.

### With the VIM-220 (ARH — fire and forget)
1. Click the **TWS** button. Build up to 3 tracks by sweeping the contacts.
2. Press **Q** until **VIM-220** is active.
3. *(Optional)* **Shift+Click** on the map to set a mid-course route:
   - First Shift+click = **waypoint 1** (a point to fly to).
   - Second Shift+click = **waypoint 2** (sets the heading after WP1).
   - A third Shift+click starts a new route.
   The route is drawn in yellow and is handed to each VIM-220 you fire. It
   fades away once the missile carrying it passes the first waypoint or is
   destroyed.
4. Press **Space**. Each press launches one missile at the track you picked
   with **F**, if it is still free; otherwise at the **nearest** un-engaged
   track, then the next-nearest, and so on. A press that launches nothing says
   why in red above the ship (wrong weapon for the mode, no rounds, no track).
   Two ships read as one contact only when the radar cannot resolve them:
   less than a beamwidth (3°) apart in bearing *and* within a pulse length
   (10 px) in range. A pair 80 px abreast stays two contacts well past the
   range ring (they merge only around 1000 px and beyond).
5. The missile flies the waypoints / its assigned track until its own radar
   activates — it arms by closing range, so there is no countdown; the cone
   readout shows **RADAR ACTIVE** once the seeker is up. After that the
   missile homes itself; you can break off.

### With the VIM-90 (IR — short range, silent)
1. Get a cue. Either lock it with the radar (**E**, STT), or step the mode
   (**X**) to **IRST**: the transmitter goes silent, as in EMCON, and the
   infrared sensor searches a narrow 20° window straight ahead — point the
   nose to look. IRST contacts are amber lines on the scope: a passive sensor
   knows the *direction* of the heat, not its range. **E** locks the IRST onto
   the contact nearest your nose; **Esc** lets go. Leaving IRST mode drops its
   contacts and lock.
2. Press **Q** until **VIM-90** is active.
3. Press **Space**. The missile's own seeker looks down the cue and must see
   heat there (*tone*) before the round is released — otherwise the shot is
   refused with **NO TONE**. The cue must also be within 45° of your nose.
4. Once off the rail it needs nothing from you: it steers itself onto the
   heat by proportional navigation. No RWR warning goes off on the target —
   neither the IRST nor the missile emits anything.

Heat depends on what the target is doing: hottest from behind at full
throttle, a tenth of that nose-on, almost nothing stopped. The seeker sees a
hot tail to ~400 px, a nose to ~150 px. Gas blinds infrared far sooner than
radar; rocks block it outright.

---

## Reading the HUD

- **Contact boxes** — tracked targets. Red = your STT lock.
- **Cone-edge readout** — active weapon name, remaining rounds, current range,
  and **RADAR ACTIVE** once the last VIM-220 fired has its seeker up (right
  edge of the cone).
- **Jammer status** — on the **left** edge of the cone: green `JAM RDY` when
  available, red `JAM 9s` counting down while active, grey `JAM CD 14s` during
  cooldown.
- **Yellow dots / line** — your placed VIM-220 waypoints and the direction leg.
- **Amber lines** — IRST contacts (bearing only, no range). A thick line with
  a bracket outside the ring is your IRST lock.
- **RWR panel (bottom-left)** — diamonds on bearings where something is
  emitting at you; red means you are locked; a red triangle with **7** or
  **22** is a missile guiding on you.

---

## Tips

- A track needs a few sweeps to settle — fire on a freshly-formed, jittery
  track and the intercept may be poor.
- VIM-177 is only as good as your lock; if you can't keep the target in the
  cone, prefer the VIM-220.
- Asteroids reflect the beam too. A "contact" that never manoeuvres and drifts
  ballistically is probably a rock.
- Throttle changes how fast you turn, not how tight: the turn *radius* is the
  same at every setting (a lower throttle just turns slower on the spot). Use
  it to hold station or to slow down for a landing, not to tighten a turn.
