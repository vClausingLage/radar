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
	-> turn to rwr warning direction
	-> Patrol
		-> track ?
			-> fly in direction of track
			-> fly in direction of warning
				-> track ?
					-> lock and shoot (see above)
					-> wait for track

Patrol -> rwr lock warning ?
	-> deploy decoy -> go in flanking direction (evade missile)


Different personalities for enemies: aggressive/defensive

Aggressive => attack enemy if tracked and try to shoot first, jamming
Defensive => try to evade, fly away from rwr warning direction, deploy decoys


Jev tactician
=============

The tree above is the *scripted doctrine*. A ship can instead be given a
tactician (`brain: 'jev'` in the target factory, cruisers only, DEV only) that
makes the one call the tree makes — which state to be in — while the
controller still flies, locks, shoots and drops chaff exactly as before.

Jev (TypeSafe's System One decision model, via OpenRouter) is a calibrated
classifier, not a chat model: it gets a state and a closed list of options
and returns a probability per option plus a confidence.

Split of responsibility
- Code decides what is POSSIBLE: the controller offers only the legal states
  (ENGAGE needs a firing solution and missiles, CRANK a shot in the air, SKATE
  a last known target, EVADE an RWR contact) and refuses anything else.
- Jev decides what is WISE among those.
- The scripted doctrine flies every frame Jev has no usable answer for:
  none yet, stale (> 2.5 s), unsure (< 50 % confidence), not on offer, or a
  failed request. Only one legal option = no question asked.

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