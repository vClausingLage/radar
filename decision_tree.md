Decision Tree

DEF patrolRoute => A patrol route is flying a horizontal or vertical line for 500 units, then turn left or right for 150 units and turn in the same direction as last turn. Then fly the same length back again and turn two times as above but on the other direction as before. So we have a search track that covers a wide area.

DEF crank => After shooting a missile turn left or right to bring the target next to the start or end angle of the radar to maximize geometric distance to target.

DEF skate => After the missile hit or missed skate away (turn away from target and fly away). 

DEF banzai => go into close combat -> does not make much sense in this game -> skip?

Patrol -> fly along patrol route

Patrol -> radar set mode RWS

Patrol -> radar set mode RWS -> track ?
-> fly in direction of track
	-> Wait 2 radar scans
		-> track ?
			-> go STT ?
			-> continue Patrol
				-> STT track ?
					-> shoot & deploy decoy
						-> crank & deploy decoy
							-> skate/banzai

Patrol -> rwr warning ?
	-> Hunt: remember the warning's bearing (20 s after it was last heard) and
	   fly down it. An RWR gives a bearing, never a range, and hears an enemy
	   radar far beyond the range our radar can paint it at (emission ~ range²,
	   echo ~ range⁴), so the warning is a lead worth following, not a scare.
		-> aggressive: radar searching (RWS) all the way in
		-> defensive: radar silent (EMCON) for the first 8 s, listening only,
		   then radiate. Only a hunt begun from patrol opens silent; one resumed
		   after losing a contact keeps radiating.
		-> track ?
			-> investigate -> lock and shoot (see above)
		-> bearing not heard again for 20 s -> Patrol
	(Missile seekers are not hunted — their bearing points at the weapon.
	 Radar cannot tell sides, so a friendly's radar is hunted too.)

Patrol -> rwr lock warning ?
	-> deploy decoy -> go in flanking direction (evade missile)


Different personalities for enemies: aggressive/defensive

Aggressive => attack enemy if tracked and try to shoot first, jamming
Defensive => try to evade, fly away from rwr warning direction, deploy decoys


Jev tactician
=============

The tree above is the *scripted doctrine*. A ship can instead be given a
tactician (`brain: 'jev'` in the target factory, cruisers only, DEV only) that
makes the one call the tree makes — which state to be in (and, for a flight lead,
which flight tactic: see below) — while the
controller still flies, locks, shoots and drops chaff exactly as before.

Jev (TypeSafe's System One decision model, via OpenRouter) is a calibrated
classifier, not a chat model: it gets a state and a closed list of options
and returns a probability per option plus a confidence.

Split of responsibility
- Code decides what is POSSIBLE: the controller offers only the legal states
  (ENGAGE needs a firing solution and missiles, CRANK a shot in the air, SKATE
  a last known target, EVADE an RWR contact, HUNT a remembered emitter bearing) and refuses anything else.
- Jev decides what is WISE among those.
- The scripted doctrine flies every frame Jev has no usable answer for:
  none yet, stale (> 2.5 s), unsure (< 50 % confidence), not on offer, or a
  failed request. Only one legal option = no question asked.
- Jev is only asked in a fight (`JevTactician.isFight`): a contact on our
  scope, our missile in the air, a skate running, an enemy lock, a missile
  inbound, or already evading. Patrol and hunt are routine the doctrine flies
  as well as Jev would, and they are most of a sortie — so most of the calls.

The flight tactic (lead only)
- A flight's LEAD is asked a second question: which flight tactic the pair should
  fly. The wing is never asked (a wing's controller consults no tactician).
- Code decides what is POSSIBLE (`Flight.legalTactics()`, built from the same
  inputs as `chooseTactic()` and always containing what the doctrine would pick):
    formation     always
    shooterCover  one group, the lead holds a track, somebody has a round (not a
                  bracket half made, not once both-armed rounds are away)
    bracket       one group the lead holds, both armed, nothing fired, room to
                  split (group beyond BRACKET_ENTRY_PX) - or already under way
    grinder       both armed and committed: rounds fired, or too near to split
- Jev decides what is WISE among those. The scripted `chooseTactic()` decides
  whenever Jev has no usable answer - the same gate as for states: none yet,
  stale (> 2.5 s), unsure (< 50 %), not on offer, failed request. Fewer than two
  legal tactics = no question. Options are shuffled per ask.
- ONE request, not two: `JevRequest.questions` carries `next_state` when the
  controller has two legal states and `next_tactic` when the flight has two legal
  tactics, so a flight costs no extra calls (and no second cadence, backoff or
  in-flight slot to keep coherent). Each is gated independently; the request fails
  only if every question in it went unanswered. The answer is read back by
  `Tactician.adviseFlightTactic`, which `Flight.review()` calls through the
  advisor the lead's controller registered.
- Jev's advice goes through the Phase 3 hysteresis like the doctrine's: the review
  runs every REVIEW_MS and a change must stand for DWELL_MS, so Jev cannot make
  the flight flicker.
- Criteria follow the V1+ lesson (say WHEN to choose, not what it does): formation
  when no group is workable together or nobody has a missile worth a shot; shooter
  and cover when we hold a track and the target should not hear a second radar, the
  group is close, or only one of us has missiles; bracket when the group is outside
  missile range, both are armed, nothing has been fired and there is room; grinder
  once missiles have been fired, or the group is too close to split, and both still
  have missiles. Not yet tuned against recorded pictures (the 2026-10-12 log is
  states only).
- The lead's picture gains words from the link: `wingman` (in formation / engaged /
  defending / lost, or 'no wingman'), `wingmanMissiles` (a count), `flightTactic`
  (the plan in force, or 'no flight') and `groupsOnLink` (none / one group / two or
  more groups). Built from the datalink's status page and the held picture, never
  the entity list.

IFF (AI)
- Every AI radar is autonomous for IFF: it interrogates matured tracks as they
  mature and re-asks every IFF_AUTO_INTERVAL_MS. Fire control is handed no track
  that answered friendly, so same-side ships outside one flight (skirmish) no
  longer engage each other (a track younger than two scans has not been asked
  yet and can still be fired on). A friendly-reply track is also out of getHostileTracks(),
  so it is not a contact to investigate or share on the flight link. No reply is
  'unknown', treated as hostile.
- The picture gains `contactIff`: 'no contact' / 'not interrogated' / 'no IFF
  reply' / 'friendly IFF reply'. Friendly-reply tracks never become the contact, so
  the last word is for completeness.
- Campaign levels have IFF off (Game.iffAvailable()), so none of this applies there.

The picture (what Jev is told)
- Only the ship's own radar, RWR and stores — never the entity list.
- Words, not numbers: ranges and angles are banded in code ("inside missile
  range", "off the nose"); Jev is no calculator. Counts (missiles, chaff) are
  the only numbers.
- Timers become words too: `skate` says "still opening range" / "range opened".

Tuning log (2026-10-12, 26 recorded duel pictures, each asked in two option
orders, compared with what the doctrine above would do)

  | variant                                   | mean conf | >= 50 % | = doctrine | EVADE on mere search |
  |-------------------------------------------|-----------|---------|------------|----------------------|
  | V0 criteria say what a state *does*       | 0.71      | 81 %    | 37 %       | 33 of 52             |
  | V1 criteria say *when to choose* it       | 0.81      | 94 %    | 85 %       | 0                    |
  | V2 V1 + engagement cycle in the question  | 0.84      | 92 %    | 90 %       | 0                    |
  | V3 V2 + `skate` progress in the picture   | 0.81      | 87 %    | 93 %       | 0                    |

  (V3 ran on 30 cases — each skating picture twice, mid-run and run complete —
  so its columns are not directly comparable with V0–V2's 26.)

- V0 evaded on any RWR search and threw all its chaff at radars that were
  not even locked. Saying when chaff is worth it fixed it completely.
- Without the skate timer Jev guessed when a run ends. With it, mid-run
  pictures are always SKATE; the remaining misses are the instant a run ends,
  where Jev answers 29–47 % — below the gate, so doctrine takes those, which
  is what the confidence gate is for.
- Jev leans toward the first option, so options are shuffled per ask.

Not yet
- Production: the static build has no proxy to hold the key, so Jev ships
  fly the scripted doctrine there.
- Binary calls (fire now? chaff now? jam now?) are still the controller's;
  they would be Noul questions in the same request.

Flights
=======

A flight is a two-ship element (`controller/flight.ts`, created with
`scene.add.flight(...)`): a LEAD that makes the decisions (Jev in DEV, the
scripted doctrine otherwise) and a WINGMAN that is always scripted and flies on
it. The Flight holds the roster, the station geometry and the intra-flight
datalink; it never runs per frame — each ship still runs its own radar and
controller.

Formation (wing)
  Lead alive and no enemy lock on us -> FORMATION
  Enemy fire-control lock on us      -> EVADE (self-defence pre-empts the lead)
  Lead destroyed                     -> the wing is a single ship again: normal
                                        doctrine (PATROL / HUNT / INVESTIGATE ...)
- FORMATION steers to a station fixed in the lead's body frame
  (`formationSettings`: 80 px abeam, 0 back). Far from it the wing points at
  the station; inside CAPTURE_PX it flies the lead's heading nudged by its
  lateral error. Throttle follows the along-track error: up to
  CATCHUP_SPEED_FACTOR x cruise to regain station, down to MIN_SPEED_FACTOR
  when ahead. Its radar stays in RWS unless the flight orders it silent
  (`Flight.wingRadar = 'silent'`: EMCON on the net, the footing for shooter/cover).
  It leaves FORMATION only to prosecute a target the sort gave it (below).
- Collisions: a cruiser's turn radius is speed / turn rate (about 19 px at the
  0.1 patrol speed), so the lead pivots almost on the spot and swings its hull
  toward a wing on the inside of the turn. Inside BREAKAWAY_PX of the lead the
  wing abandons its station and flies directly away from it (holding its thrust
  while its nose still points at the lead - it cannot turn out in the room left), in any state
  (EVADE and the border turn included), then rejoins. Spacing 80 px plus that
  guard keeps the closest approach above ~55 px in the tests (hulls are ~28 px
  across).
- Radar picture of the pair: abreast, a flight is held as ONE track by a
  nose-on radar (the tracking computer associates returns within
  TRACK_GATE_RADIUS_PX = 200 of a track with that track), and as two once the
  wing is more than that apart. The beam's resolution cell
  (S / tan 3 deg = ~1500 px for S = 80) would only matter if the gate did not
  act first.

Friend and foe: PPLI
- A radar cannot tell sides: a track is geometry, an RWR contact a bearing.
  Each member's terminal broadcasts its PPLI (id, position, velocity) into the
  flight's `FlightDatalink` every frame, whatever its radar is doing (EMCON
  included - the link is not a radar emission).
- Tracks: after every radar update a datalinked radar tags each track within
  PPLI_CORRELATION_PX (+ the member's speed x PPLI_SCAN_LAG_MS) of a wingman's
  PPLI as `friendly`. The track stays in the tracking computer (a real echo,
  it still shadows what is behind it) but is withheld from fire control
  (`displayedTracks`: no lock, no VIM-220 shot, no guidance onto it) and from
  the AI (`getHostileTracks`: never investigated, engaged or reported to Jev).
- RWR: an emitter whose bearing lies within RWR_BEARING_ACCURACY_DEG of a
  wingman's bearing is the wingman's radar and is hidden from the warning
  picture - not hunted, not evaded (a lock from it never means EVADE), not
  reported to Jev. Only *search* emitters are filtered: a lock and a missile
  seeker are never friends (a flight's fire control cannot lock a datalinked
  wingman, so a lock on us is an enemy's, and EVADE must fire even when it sits
  behind the wingman). Limitation, on purpose: a real searching enemy exactly
  behind the wingman's bearing, or a hostile track within the correlation gate
  of the wingman, is masked.
- The player's radar has no datalink and behaves as before.

Shared picture
- Every frame each member puts its matured (LINK_TRACK_MIN_AGE_SCANS) hostile
  tracks on the link, replacing what it sent before; a report not refreshed for
  LINK_TRACK_STALE_MS drops out. A radar in EMCON holds no tracks and sends none.
- Reports within LINK_TRACK_CORRELATION_PX (the tracker's 200 px gate) are one
  target; the fused list is built only from the link, in a fixed order.

Sort (`Flight.assignmentFor`)
  2+ groups -> lead takes the left-most, wing the right-most (azimuth off the
               lead->picture axis, so crank/skate turns cannot swap them)
  1 group   -> lead takes it; the wing has nothing to sort and stays in FORMATION
- Lead: works its group (its own track in it; falls back to its best track if it
  holds none there). Its TWS shots are confined to that track.
- Wing, sorted group, own track on it -> the normal cycle on that track
  (INVESTIGATE -> TWS -> ENGAGE -> CRANK -> SKATE), confined to it.
- Wing, sorted group, no own track, lead's link track available -> cued
  (`contactViaLink`): INVESTIGATE closes on the link track in EMCON; once the
  track is inside the *wing's* ring and a VIM-220 is on the rail -> ENGAGE
  = launch on remote (`Radar.shootOnRemote`). The wing has no VIM-177 remote
  option: with only 177s it radiates in RWS to find the target itself.
- After the shot: CRANK / SKATE as usual, then back to FORMATION once the group
  is gone from the picture, or the wing is out of missiles.

Launch on remote
- The one exception to "fire control sees only displayedTracks()": a named path
  (`FireControl.shootOnRemote`) taking a track off the link, fresh and inside the
  shooter's RADAR_DEFAULT_RANGE_PX. The missile is guided mid-course from the
  link while the lead holds the track (and it stays inside the wing's ring);
  when the link track is lost it flies on, as if its launching radar had lost
  the track. The target's RWR never hears the wing's radar before the launch.

Tactics (`Flight.tactic`, chosen by `Flight.chooseTactic()`)
The tactic is the flight's one plan for one group of targets. The lead's side
decides it - by the scripted doctrine below, or by Jev for the
lead - and it is built only from the shared picture and the members' stores and
states, never from the entity list. The wing never decides; it executes the
orders (`Flight.ordersFor`: may it shoot, must it stay silent) and the geometry
(`Flight.closing`) and picks its state as it always does.

  Picture empty for PICTURE_HOLD_MS (8 s once rounds are away)  -> formation
  2+ groups                          -> formation; the sort gives each member its own
  1 group, lead holds no track of it -> formation; the wing's track is a CUE: the
                                        lead points at it and radiates to look, but
                                        has nothing to shoot on (wing -> lead cueing)
  1 group, lead holds a track:
    neither member has a round       -> formation
    only one has rounds              -> shooterCover (the armed one shoots)
    both armed, rounds already fired this fight  -> grinder
    both armed, nothing fired:
      group farther than BRACKET_ENTRY_PX  -> bracket   (room to split first)
      nearer, wing holds a VIM-220         -> shooterCover (the quiet shot)
      nearer, wing has none                -> grinder
  Opener tactics are sticky: bracket and shooterCover stay until a round has been
  fired; then the fight is a grinder, and stays one.

  formation     the Phase 1/2 behaviour (above). While the plan is being settled
                (1 group, lead holds it) nobody fires and a wing that can fly a
                VIM-220 on the link already holds EMCON.
  shooterCover  The lead radiates (TWS) and holds the track; the wing is silent and
                makes the shot on remote. The lead does not shoot while the wing
                has a VIM-220 (it does once the wing is dry). The wing stays on its
                station abeam of the lead - it closes with the lead, not on the
                group, so the two never converge on one point. Why: the target's
                RWR shows one emitter, the lead; the shooter is the one it never
                heard.
  bracket       Both radiate. Each swings out to its own side of the axis from the
                flight's centre to the group, to BRACKET_HALF_ANGLE_DEG (60) off it,
                pointing at most BRACKET_MAX_LOS_OFFSET_DEG off the line of sight
                so the group stays in its TWS cone; then it flies straight in
                along its ray. Opening outward from each other they never cross
                (lead and wing mirrored). Why: past the 30 degree RWS half-azimuth
                the target cannot keep both in one scan. Nobody shoots until the
                pair is BRACKET_SPLIT_DEG (35) apart as the group sees it, or a
                member is within BRACKET_ABANDON_PX of the group. Both may then
                shoot at the one group (the Phase 2 confinement to a member's own
                sorted track still applies when there are two groups).
  grinder       Both committed; steady pressure. One shot-taker token: the member
                that did not shoot last (the other when it is dry). The holder
                shoots and cranks; the other closes and holds fire; the token
                then passes. The bracket's divergence is kept, so the shooter's
                crank does not turn across its partner. The token outlives a
                break in the picture.

- Collision safety beyond break-away (all tactics): a closing member holds
  STANDOFF_PX (200) off the group rather than ramming it; the wing looks ahead
  (`Flight.onCollisionCourse`: closest approach under PREDICT_CLEAR_PX within
  PREDICT_HORIZON_FRAMES) and sidesteps SIDESTEP_DEG off the lead's heading to the
  side it is already on - run for it if ahead of the lead, drop back if behind -
  before break-away would be too late for a 0.3 deg/frame turn; and a wing that
  comes back well over on the side its station is not on takes that side instead
  of crossing behind the lead's tail (`swapSidesIfNeeded`; never in shooterCover or
  bracket, whose geometry is the sides, and not twice within SWAP_COOLDOWN_MS).
- Cranking is outboard: in a flight each member cranks away from its partner
  (`Flight.outboardSide`), not toward the world centre, so two ships that fire
  together do not turn across one another. Break-away (above) still guards the
  hulls in every tactic.
- Hysteresis: the doctrine is reviewed every REVIEW_MS (500 ms) and a new answer
  must stand for DWELL_MS (1.5 s) before the flight acts on it; a blink of the
  picture is "no opinion" and leaves a change of mind in progress alone. A track
  the lead lost for under PICTURE_HOLD_MS still counts as held.
- Sort stability: the sort works from a held picture. A group that blinks out of
  the link keeps its place (and its assignment) until it has been missing for
  PICTURE_HOLD_MS (8 s ENGAGED_HOLD_MS once rounds are away - a pair that has shot
  is cranking away, which is when its radars lose the group). A fight that breaks
  off and re-forms within ENGAGEMENT_MEMORY_MS (60 s) resumes as the grinder.
- STT collapse: a lead that locks for a VIM-177 keeps one track, and renumbers
  the rest when the lock is dropped. A wing's remote-launched missile is
  guided by the mate's track number, so it would be orphaned. It re-associates
  once with the link track nearest the target's last position (the 200 px
  correlation gate) and takes the new number; with nothing near, it flies to the
  last link position rather than straight on. Holding fire (the cover) never
  locks - it stays in TWS.
- Seeker PPLI: the wingman's hull is in the seeker's world (it reflects and can be
  hit). A VIM-220 is handed its launcher's PPLI picture of the flight every frame
  (the datalink uplink) and its seeker neither locks nor re-acquires a return that
  correlates with a mate's PPLI - geometry only, the radars' own correlation gate.
  The picture is refreshed only while the launcher lives; with the shooter dead it
  ages out after PPLI_STALE_MS (500 ms) and the seeker can lock a mate.
- Shooter deconfliction (`Flight.clearToFire`, used by the controller before any
  shot, own track or remote): hold fire when a mate is inside the target's PPLI
  correlation gate, or inside the cone the round would search once its seeker wakes
  (ACTIVE_RADAR_ACTIVATION_RANGE short of the target on the shooter's line,
  +/- ACTIVE_RADAR_AZIMUTH, out to ACTIVE_RADAR_RANGE). Bracket and cover geometry
  keep the mate out of it; if not, the shot waits. A missile that still meets a
  mate is friendly fire and nothing prevents it.
- Participant status: each member publishes a status page (stance: in formation /
  engaged / defending, and its missile count) on the link every frame, next to its
  PPLI. The lead's picture reads the wingman from it - or 'lost' once it has been
  quiet for PPLI_STALE_MS.

Jev chooses the flight's tactic (below). `Flight.legalTactics()` is the list of what is
possible; Jev picks among them for the lead, and the review's dwell still applies.

