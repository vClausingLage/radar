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

**Callsigns — decided and live:** the station is **Disco**; the player is
**Flatspin 1-1**.

**Two voices, two engines** (`tools/generateClips.js`, run with
`node tools/generateClips.js`; existing files are left alone, `--force`
regenerates): the GCI voice is ElevenLabs (voice ID in the script); the
player's ship — both `RadarVoice`'s own-radar callouts and the new player
radio calls — is OpenAI TTS (`gpt-4o-mini-tts`, voice `ash`). Because they're
two distinct recordings, shared vocabulary (digits, `bra`, `for`, aspect
words, callsigns) needs a clip per speaker — hence the `gci-`/`plr-` key
prefixes below. The player-side clips reuse `RadarVoice`'s unprefixed digit
clips directly (same voice/settings) rather than re-recording them.

**Clips recorded:**
- Unprefixed (player/ship voice, `RadarVoice`): digits `zero`–`nine`,
  `100`–`1000`, `bra`, `for`, `hot`, `cold`, `flanking`, `beaming`,
  `new-radar-contact`.
- `gci-*` (Disco, ElevenLabs): digits `gci-zero`–`gci-nine`, `gci-100`–
  `gci-1000`, `gci-bra`, `gci-for`, `gci-hot`, `gci-cold`, `gci-flanking`,
  `gci-beaming`, `gci-clean`, `gci-hostile`, `gci-buster`, `gci-gate`,
  `gci-saunter`, `gci-disco`, `gci-flatspin`.
- `plr-*` (player radio voice, OpenAI): `plr-disco`, `plr-flatspin`,
  `plr-bogey-dope`, `plr-fox`.

**Live interaction** (`SupportRadarComms`, Level 1 only). Two kinds of
traffic. On request (key `C`) the player transmits "Disco, Flatspin 1-1, bogey
dope"; Disco replies with the nearest datalink contact's BRA + range + aspect +
identity plus a speed order — `gate`/`buster`/`saunter` picked from
range-to-contact — or "clean" if the picture is empty. Unprompted
(`announceNewContact`), Disco passes each new contact its dish forms once the
track has matured, one call at a time with a gap between them, so the player
is led to traffic without asking. Identity is declared by the scene, not the
radar: a contact is a `bogey` until the player has put eyes on it (visual
identification inside `VID_RANGE_PX`), after which the datalink track sitting
on that ship is called `friendly`. Only `gci-hostile` is recorded so far — the
`gci-bogey` / `gci-friendly` keys are already in the stitched message and the
`AudioPlayer` skips them until the clips exist, so those declarations reach
the player on the HUD echo only. Aspect classification (`hot`/`flanking`/
`beaming`/`cold`) is shared with `RadarVoice` via `GameMath.getAspect`.

**Missile-launch call** (`MissileCallout.announceFired`, every scene): a
confirmed missile launch (not just a trigger pull — no lock/ammo/wrong-weapon
shots stay silent) fires a `'missile-fired'` event on `Radar.eventEmitter`;
only the player's own radar has a listener (wired in `Game.create()`), so AI
ships firing the same weapons never key the radio. The player transmits
"Flatspin 1-1, fox one" for VIM-177 (SARH) or "Flatspin 1-1, fox three" for
VIM-220 (ARH) — brevity code for the guidance kind, matching real Fox 1/3
usage. No cooldown (`AudioPlayer` built with `cooldownMs: 0`), since it's a
deliberate one-off event rather than ambient chatter to throttle.

**Clip inventory not yet recorded** (future work — vocabulary defined above,
not wired to any game event yet):

- *Identity:* `bogey`, `friendly` (both already wired into the bogey-dope /
  new-contact calls — record them and add the keys to Level 1's preload),
  `bandit`, `contact`, `faded`, `group`
- *Geometry:* `bullseye`, `drag`, `angels`
- *Routing:* `commit`, `vector`, `come-left`, `come-right`
- *Threat:* `threat`, `defend`, `spike`, `nails`, `singer`, `heads-up`
- *Engage/recover:* `target`, `splash`, `abort`, `judy`, `rtb`, `pigeons`, `bingo`, `state`
- *Admin:* `lima-charlie`, `say-again`, `wilco`, `how-copy`

Bullseye is the next biggest atmosphere win per §1 — the station's own
position is the fixed reference, so the bearing/range math is the same as the
existing BRA call, just anchored on the station instead of the player.

---

## Sources

- [Multi-service tactical brevity code — Wikipedia](https://en.wikipedia.org/wiki/Multi-service_tactical_brevity_code)
- [Getting started with GCI/AWACS — Hoggit DCS Wiki](https://wiki.hoggitworld.com/view/Getting_started_with_GCI/AWACS)
- [Ground-controlled interception — Wikipedia](https://en.wikipedia.org/wiki/Ground-controlled_interception)
- [DCS Combat Brevity — Quick Guide & Dictionary (FK Gaming)](https://www.fkgaming.eu/guides/community-guides/other-games/dcs-combat-brevity/)
- [Brevity — Multi-Service TTP (AFTTP 3-2.5, official PDF)](https://static.e-publishing.af.mil/production/1/lemay_center/publication/afttp3-2.5/afttp3-2.5.pdf)
- [Ground Control Interception — IVAO Documentation](https://wiki.ivao.aero/en/home/specialoperations/so-training-documentation/SpecialOperationsFlying/GCI)
