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