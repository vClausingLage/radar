# GCI Communication Reference

Research reference for building GCI-style (Ground-Controlled Intercept) radio
atmosphere, à la *Air Defender*. The support **dish radar station** is, in game
terms, a GCI station: a fixed early-warning radar that tracks contacts and
vectors the player's fighter. This vocabulary drops onto that station's datalink
voice and fits the existing stitched-clip pipeline (`AudioPlayer` +
`SupportRadarComms` / `RadarVoice`).

Sources are listed at the bottom. Brevity definitions are standardized codewords
(facts); paraphrased/condensed here for game use.

---

## 1. How GCI comms are structured

Every transmission is **`<to>, <from>, <message>`**. The controller has an
evocative one-word callsign; the fighter an alphanumeric one:

> "Uzi 1-1, Magic, radar contact, bullseye 270/40, tracking east, hostile."

- **Numbers are spoken as individual digits.** Bearing is always three digits
  ("two-seven-zero"); altitude in **angels** = thousands of feet ("angels
  one-five").
- **Readback discipline is minimal.** The fighter acknowledges a BRAA/target
  call with **callsign only** — "Uzi 1-1" — never a full readback. That terse
  rhythm is what makes it sound military.
- **`Lima Charlie`** = "loud and clear" (radio-check reply).

### Two ways to give a position — pick one, be consistent

| Format | Reference point | Call | Best for the game |
|---|---|---|---|
| **Bullseye** | A fixed pre-briefed point both sides know | "bullseye 270/40" (bearing/range from the point) | **The dish station = the bullseye.** Natural: it's the fixed reference broadcasting the picture |
| **BRAA** | The fighter's *own* aircraft | "BRAA 100/40, 15 thousand, hot, hostile" | On-request "bogey dope" — bearing relative to the player |

The current callout (`bra <bearing> for <range> <aspect>`) is already BRAA.
Adding a **bullseye** picture from the station is the biggest atmosphere win,
and its math is trivial — the station's own position *is* the bullseye.

---

## 2. Vocabulary by game function

### Contact reporting & identity
| Term | Meaning |
|---|---|
| **Contact** | Sensor hit at the stated position |
| **Bogey** | Contact, identity **unknown** |
| **Bandit** | Positively identified **enemy** |
| **Hostile** | Enemy, **cleared to engage** per ROE |
| **Friendly** | Positively identified friendly |
| **Group** | Contacts within ~3 nm of each other (one "blip" to route against) |
| **Clean** | No sensor info — "picture clean" = empty sky |
| **Faded** | Contact **lost** but probably still there (last known position given) |
| **Gadget** | Radar/emitter equipment ("gadget down" = radar u/s) |
| **Gorilla** | Large force, indeterminate numbers/formation |

### Position geometry — aspect (game already has 3 of these)
| Term | Target is… |
|---|---|
| **Hot** | Nose-on, closing toward friendlies |
| **Flanking** | Diagonal, ~31–70° off its nose |
| **Beaming** | Perpendicular, flying across you — *worth adding* |
| **Cold / Drag** | Tail-on, moving away |

### Picture labels (multiple groups — flavor for later levels)
**Single** (one group), **Heavy** (3+ contacts in a group), azimuth/range split,
**Wall** (3+ groups line-abreast), **Ladder** (groups stacked in range), **Vic**,
**Champagne** (three-group shapes).

### Routing / vectoring / speed  — the "routing planes" core
| Term | Meaning |
|---|---|
| **Vector `<hdg>`** | "Alter heading to 270" — the core routing command |
| **Come left / come right `<hdg>`** | Directive turn in a direction |
| **Flow `<dir>`** | Maneuver in a stated direction/heading |
| **Snap `<hdg>`** | Immediate vector to a group (fighter-requested) |
| **Cutoff** | Intercept using cutoff (lead-pursuit) geometry |
| **Commit** | "Intercept the group" — the go order |
| **Buster** | Fly max **continuous** speed |
| **Gate** | Fly as fast as possible (afterburner/max) |
| **Saunter** | Fly best endurance (slow down / conserve) |
| **Angels `<n>`** | Altitude in thousands of feet |

### Threat & defensive
| Term | Meaning |
|---|---|
| **Threat `<dir>`** | Untargeted hostile within briefed range |
| **Defend / Defensive** | Under attack — react |
| **Break `<dir>`** | Immediate max-performance turn (last-ditch) |
| **Spike** | RWR: enemy interceptor **tracking/launching** on you |
| **Nails** | RWR: enemy radar in **search** (not locked yet) |
| **Singer** | RWR: **SAM launch** detected |
| **Notch / Crank** | Defensive maneuver relative to the threat |
| **Heads up** | Alert of activity of interest |

### Engagement & weapons
| Term | Meaning |
|---|---|
| **Target `<group>`** | Controller assigns a specific group |
| **Sort** | Divide responsibility within a group |
| **Judy** | "I've got the intercept — minimize your calls" (fighter takes over) |
| **Tally** | I see the target/bandit. Opposite: **No joy** |
| **Visual** | I see the friendly. Opposite: **Blind** |
| **Merged** | Friendly and target in the visual arena (radar can't separate) |
| **Fox 1 / 2 / 3** | Missile away — 1 = semi-active radar, 2 = IR, 3 = active radar |
| **Splash** | Target **destroyed** |
| **Abort** | Break off the attack |

### Recovery / fuel / admin
| Term | Meaning |
|---|---|
| **RTB** | Return to base |
| **Pigeons `<brg>/<range>`** | Magnetic bearing + range **home** — the recovery vector |
| **Bingo** | Pre-briefed fuel state to break off and recover |
| **State** | Report fuel/weapons remaining |
| **Winchester** | Out of weapons |
| **Wilco** | Will comply. **Say again** = repeat. **Copy** = understood |

---

## 3. Ready-to-stitch call scripts, mapped to game events

`[..]` = a stitched number; **bold** = a clip to record. Station callsign shown
as *Sentinel* (placeholder).

| Game event | Station → player call |
|---|---|
| Dish detects new contact (datalink) | "Player, **Sentinel**, **new contact**, **bullseye** [270] [40], **angels** [15], **hostile**." |
| Player presses "bogey dope" | "Player, **Sentinel**, **BRAA** [100] **for** [40], **hot**, **hostile**." — or if none: "**clean**." |
| Vector to intercept | "Player, **Sentinel**, **commit**, **vector** [270]." / "**come right** [090]." |
| Speed | "**Buster**." / "**Saunter**." |
| Contact turns away / lost | "Contact **cold**." / "**Faded**, last **bullseye** [270] [40]." |
| Threat warning | "**Threat**, **bullseye** [180] [20]." / "**Defend**, **spike** [090]." |
| Kill confirmed | "**Splash**, good kill, **clean**." |
| Recovery | "Player, **Sentinel**, **RTB**, **pigeons** [180] **for** [60]." |
| Radio check / ack | Station: "…how copy?" Player: "**Lima Charlie**." Ack: just the callsign. |

---

## 4. Implementation notes (fits the current pipeline)

**Clips already recorded:** digits `zero`–`nine`, `100`–`1000`, `bra`, `for`,
`hot`, `cold`, `flanking`, `new-radar-contact`.

**Clip inventory to record next:**

- *Identity:* `bogey`, `bandit`, `hostile`, `friendly`, `clean`, `contact`, `faded`, `group`
- *Geometry:* `bullseye`, `beaming`, `drag`, `angels`
- *Routing:* `commit`, `vector`, `come-left`, `come-right`, `buster`, `gate`, `saunter`
- *Threat:* `threat`, `defend`, `spike`, `nails`, `singer`, `heads-up`
- *Engage/recover:* `target`, `splash`, `abort`, `judy`, `rtb`, `pigeons`, `bingo`, `state`
- *Admin:* `<station-callsign>`, `lima-charlie`, `say-again`, `wilco`, `how-copy`

**Callsign for the dish station** — GCI callsigns are single evocative words
(real: *Magic, Overlord, Darkstar, Wizard, Sentry, Bandsaw, Disco*). For this
setting: **Sentinel, Watchtower, Overwatch, Warden, Beacon, Anvil**.

**Architecture** — a natural extension of what exists:

- `SupportRadarComms` already builds a BRAA call. Extend it with a **bullseye**
  picture call (station position = bullseye, so bearing/range are trivial) and an
  **aspect + declaration** suffix (`hot`/`cold`/`flanking`/`beaming` +
  `bogey`/`bandit`/`hostile`).
- It slots into the existing `AudioPlayer` clip-stitching. The "GCI voice"
  belongs to the station subsystem, distinct from the player's own `RadarVoice`
  (which announces the player's *own* radar contacts).
- Add a 4th aspect (`beaming`) plus the `bullseye`/`angels` vocabulary and a
  dozen new clips cover ~80% of the atmosphere.

---

## Sources

- [Multi-service tactical brevity code — Wikipedia](https://en.wikipedia.org/wiki/Multi-service_tactical_brevity_code)
- [Getting started with GCI/AWACS — Hoggit DCS Wiki](https://wiki.hoggitworld.com/view/Getting_started_with_GCI/AWACS)
- [Ground-controlled interception — Wikipedia](https://en.wikipedia.org/wiki/Ground-controlled_interception)
- [DCS Combat Brevity — Quick Guide & Dictionary (FK Gaming)](https://www.fkgaming.eu/guides/community-guides/other-games/dcs-combat-brevity/)
- [Brevity — Multi-Service TTP (AFTTP 3-2.5, official PDF)](https://static.e-publishing.af.mil/production/1/lemay_center/publication/afttp3-2.5/afttp3-2.5.pdf)
- [Ground Control Interception — IVAO Documentation](https://wiki.ivao.aero/en/home/specialoperations/so-training-documentation/SpecialOperationsFlying/GCI)
