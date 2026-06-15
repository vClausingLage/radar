# Player Guide

## What this game is

You command a single ship carrying a simulated airborne **fire-control radar**.
The radar is not a magic "see everything" sensor — it has to *sweep* a cone in
front of you, build **tracks** from the noisy returns it gets off enemy hulls,
and hold a target steady enough to guide a missile onto it. Flying well means
managing where your radar is looking, which mode it is in, and which weapon
suits the situation.

The map also contains other ships (targets) and drifting asteroids. Asteroids
and ships both reflect your radar beam, so clutter and real contacts share the
same screen — part of the challenge is telling tracks apart.

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

See [radar.md](radar.md) for how the simulation actually works under the hood.

---

## Keyboard & mouse

| Input | Action |
|-------|--------|
| **A / D** | Turn left / right |
| **R** | Switch to **RWS** (search) |
| **E** | Enter **STT** — lock the best current track |
| **Esc** | Break STT lock, return to RWS |
| **Q** | Cycle active weapon (VIM-177 ↔ VIM-220) |
| **Space** | Fire the active weapon |
| **T** | Deploy a decoy (chaff) |
| **Shift + Click** | Place a VIM-220 mid-course waypoint (VIM-220 selected) |
| **Mouse + / −** buttons | Zoom the camera |

**TWS** has no key binding — use its on-screen button. On-screen buttons next to
the ship mirror the mode and fire controls, and the speed buttons (1/3, 2/3,
FULL) set throttle.

## Decoys (chaff)

You carry **5** decoys. Press **T** to drop a chaff cloud at your current
position. A cloud lingers for a few seconds and fades out. While a radar beam
passes through a cloud, the return may be lost — so if you manoeuvre so a cloud
sits **between your ship and a threat radar (or an incoming missile)**, you can
break its lock. It's probabilistic: a single cloud won't always work, and
stacking several in the line improves your odds.

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
   The route is drawn in yellow and is handed to each VIM-220 you fire.
4. Press **Space**. Each press launches one missile at the **nearest**
   un-engaged track; the next press takes the next-nearest, and so on.
5. The missile flies the waypoints / its assigned track until its own radar
   activates — the **TTA** (time-to-active) countdown next to the radar cone
   shows the seconds remaining, then reads **RADAR ACTIVE**. After that the
   missile homes itself; you can break off.

---

## Reading the HUD

- **Contact boxes** — tracked targets. Red = your STT lock.
- **Cone-edge readout** — active weapon name, remaining rounds, current range,
  and the **TTA** line for the last VIM-220 fired.
- **Yellow dots / line** — your placed VIM-220 waypoints and the direction leg.
- **RWR panel (bottom-left)** — diamonds on bearings where something is
  emitting at you; red means you are locked.

---

## Tips

- A track needs a few sweeps to settle — fire on a freshly-formed, jittery
  track and the intercept may be poor.
- VIM-177 is only as good as your lock; if you can't keep the target in the
  cone, prefer the VIM-220.
- Asteroids reflect the beam too. A "contact" that never manoeuvres and drifts
  ballistically is probably a rock.
- Throttle down to turn tighter and keep a fast crosser inside your cone.
