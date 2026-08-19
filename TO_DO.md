## PHASER JS RADAR


- [x] STT remove hack -> real implementation (closed-loop angle tracking: antenna slews to the tracking computer's estimate at a finite rate; the beam, not a truth lookup, decides what is seen — ship STT and both missile seekers)
- ADD Clutter -> https://de.wikipedia.org/wiki/Clutter_%28Radar%29

# To Dos

For this radar simulation game it is important that radar is simulated in a very realistic way. I want to confirm the following: Travelling radar waves loose energy squared per distance (^4 considering round trip of reflected signal back to source). So range is physically tied to energy. The 'range' of a radar is based on convention/setting of the radar: Per signal only returns are processed that are inside a defined time interval to prevent return signal from previous waves to be treated as tracks.  


- move visibility material etc and other atributes to group instead of the objects themselves
- gas clouds that reduce radar effectiveness
- IRST -> exhaust detection -> IR missiles
- drone behaviour (no shooting but jamming)
- add jammer usage to ai behaviour

# RADAR

- MAKE SHURE that radar has no range but only energy
- noise
- distance -> exponential falloff
- target size
- cross section -> side / front

# Testing

## manual

- missilies dont die if owner dies

## auto

WHERE TO ADD TESTS?
