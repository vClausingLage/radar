Decision Tree

DEF patrolRoute => A patrol route is flying a horizontal or vertical line for 500 units, then turn left or right for 150 units and turn in the same direction as last turn. Then fly the same length back again and turn two times as above but on the other direction as before. So we have a search track that covers a wide area.

DEF crank => After shooting a missile turn left or right to bring the target next to the start or end angle of the radar to maximize geometric distance to target.

DEF skate => After the missile hit or missed skate away (turn away from target and fly away). 

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


Patrol -> rwr warning ???

Patrol -> rwr lock warning ???



Different personalities for enemies: aggressive/defensive