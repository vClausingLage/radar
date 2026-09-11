# Campaign — "The Door in the Gas"

Three short missions flown from the same rock. The same theatre every time.
A pad on the surface, the dish radar **Disco** on its asteroid to the north,
and the gas band to the north-west. Nothing inside the band or behind it
shows on anyone's radar. The Compact holds on the far side. It watches the
band from there, and later comes through it.

The tone is milsim with a straight face: brevity code, readbacks, ROE and a
radar that can't tell friend from foe. The humour comes from the people on
the frequency, not from the game winking at the player.

All lines live in `src/audio/radioScript.json` (subtitle `text`, spoken
`say`). `tools/generateClips.js` records them to `public/audio/story/`.

## Cast

| Call sign | Who | Voice |
|---|---|---|
| **ANVIL** | Wing ops, the colonel who runs the rock. Briefs, debriefs and owns the ROE. Protective of his coffee. | ElevenLabs "Bill" |
| **DISCO** | GCI controller on the dish. Dry and unflappable. Nothing surprises him, and he still notices everything. | ElevenLabs (the existing GCI voice) |
| **FLATSPIN 1-1** | The player. Terse. | OpenAI `ash` (the existing player voice) |
| **MULE 2-1** | Hauler flight lead. Veteran trucker, wry. | ElevenLabs "Brian" |
| **MULE 2-2** | Hauler. Very nervous about fighters. | ElevenLabs "Eric" |
| **MULE 2-4** | Hauler. The flight gossip. | ElevenLabs "Chris" |
| **MULE 2-3** | The flight's straggler. Dead transponder, always late, panics loudly and recovers fast. | ElevenLabs "Charlie" |
| **LANTERN 5** | Chief engineer of a crippled survey ship. Frightened, brave and polite. | ElevenLabs "Alice" |

To recast a part, change its voice ID in `STORY_VOICES` in
`tools/generateClips.js`, then rerun with `--force --only=<key prefix>`.

## Level 1 — Mule Train

*Tasking:* Mule flight is inbound from the north with the monthly resupply:
three haulers, transponders off. Radar shows three bogeys, and three raiders
would look exactly the same. Put eyes on every hauler before it reaches the
pad. Stay east of the gas: pickets sit in its shadow, and if one gets a track
on you the approach is burned.

*Beats:* Anvil briefs during the cold start and Disco checks in. The player
calls airborne and Disco vectors north. Each hauler answers when the player
identifies it. Mule 2-1 is guarding the colonel's coffee. Mule 2-2 is
extremely friendly, please. Mule 2-4 reports that 2-3 is "late again,
probably stopped for gas — the other kind". That line plants the rest of the
campaign.

*Win:* all three identified. *Lose:* a picket tracks you, or you shoot a
Mule.

## Level 2 — Shepherd

*Tasking:* The survey ship **Lantern 5** went quiet while mapping the far
edge of the gas. Disco has her as a weak return drifting out of the band. Her
reactor is scrammed and she has no drive and no transponder, and her way is
carrying her back into the gas. Find her, identify her, hold alongside while
the tow line goes across, and drag her home.

*Mechanics:* Lantern is a hulk with no controller, her radar in EMCON and her
engines out. Her drift is the clock. To pass the line, hold within ~130 px at
1/3 ahead or slower for 5 s. Under tow she trails on a one-way line
(`entities/towLine.ts`). Within 300 px of the pad she is cast off and glides
down onto it.

*Twist:* the line going across is the cue for the ship that crippled her to
come back out of the gas. Disco declares it hostile the moment the dish holds
it. The player has to fight while towing.

*Beats:* Lantern's engineer: "eleven souls aboard, air for a while — not a
long while." When the tow line is fast: "please don't take the scenic
route." After the splash she promises to name a crater after you. Anvil:
drinks are on the survey corps, "they just don't know it yet."

*Win:* Lantern on the pad. *Lose:* she drifts into the gas, she is
destroyed, or a picket tracks you.

## Level 3 — Backdoor

*Tasking:* The picket line went dark two hours ago. "Either they've gone
home, or they're coming through. Nobody on this rock believes they've gone
home." Hold a CAP between the gas and the pad. Mule 2-3 is still overdue, so
anything coming out of the cloud is a bogey until you have eyes on it.

*Beats:* A single contact emerges with no squawk. Disco: "Declare bogey. Go
VID — do not engage." It's Mule 2-3: "Don't shoot! Transponder's been dead
since Tuesday — I filed a ticket!" He's had company since the far side of
the gas. Two raiders come out behind him. Disco declares them hostile and
clears the player hot, and Anvil sets condition red. The raiders chase the
hauler, and their routes run to the pad and to the dish.

*Win:* both raiders splashed and Mule 2-3 down. Anvil: "The door held… and
would somebody please fix Mule 2-3's transponder." *Lose:* a raider reaches
the pad or the dish, or Mule 2-3 is lost. The ROE trap is real: STT locks the
strongest track, so with the hauler close in front of you that lock is him.

## How it's wired

- `scenes/campaignLevel.ts` holds the shared theatre (surface, pad, dish,
  gas band, pickets, raiders), cold start, VID, the no-go zone, verdicts, and
  ENTER (next mission or retry) / M (menu).
- `audio/radioNet.ts` is one frequency. Transmissions go out in order and
  never over each other or over Disco's datalink calls. Each line shows as a
  subtitle along the top. A line without a recording stays up for its reading
  time, so the story plays in full before any voices are generated.
- Raiders are cruisers with an ingress route
  (`AiUnitController.setRoute`). The route is their search: they break off to
  engage whatever they find, then rejoin it.
