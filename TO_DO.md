## PHASER JS RADAR

# To Dos

AIM :: DO AN ACTUAL RADAR SCAN IN STEPS RATHER THAN ALL AT ONCE (SEE lightRadar.ts)

- DI
- update missile size
- ship -> bring radar from constructor to factory
- prevent shooting sarh missiles in tws without stt
- remove unneccesary constructor props ship, controller
- ADD RWR ALERTS FOR ENEMIES THAT ARE RADAR TRACKED
- VISIBILITY ON SHIP CLASSES TO PRIVATE / PROTECTED
- ASTEROID RENDERER
- VISIBILITY OF THINGS NEAR SHIP (SHIPS; ASTEROIDS) => ~ 250 UNITS?
- TARGETS IN RANGE MUST BE IF 2 OF 4 CARD POINTS ARE IN MIN/MAX ANGLE

# RADAR

- noise
- distance -> exponential falloff
- target size
- cross section -> side / front
- radar range = 80% of RWR range
- Ping Signal RWR If detected by RWS to target


# TWS

- Missile follows rarad intercept course, then activates its own radar to home in on target
- TWS to track multiple targets
- Logic for target history: how to correlate new radar returns with existing tracks
- target prorization by distance
- ADD TWS MODE
- ADD POSSIBILITY FOR RADAR TO SAVE TRACKS / TARGETS
- azimuth
- range
- wake up point missile
- missile radar

Missile Radar
Missile Behaviour
A/G Radar / ground, buildings etc

Konversationen einbauen
RIO Nachrichten einbauen
New Radar Contact BRA xxx xxx hot cold flanking