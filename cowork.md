This is a game that reflects a simulation of airborne radar transformed in a 'space' environment. 

I have two goals: Learn software architecture, radar technology and game development fundamentals.

The project achieved a working state in the main branch and is now in the update branch. The main branch has a LightRadar setup, a simpler simulation of a radar. Now my aim is to make it a real simulation. The core is already set up and i want to finish it step by step. 

The radar is set up in modules to reflect their real world equivalents and also to structure the project. 

radar.ts is the center.

Transmitter: When hitting an object, send RWR warning to tracked object ( when tracking object has mode === rwr/tws) or lock (when tracking object has mode === stt) to target. use phaser event emitter (or alternative)

Receiver: Should determine if signal comes back to radar and can be used in TrackingComputer. Here is the place for the Radar Equation. Cross section may be just a threshold of points that need to be returned (but the could be angles defined in the ship class to set cross section based on angle to radar, because objects return radar signals not isotropically). Or points are returned on a statistical basis with randomness. 

Doppler Shift is a main problem for the simulation. To add a 'real' doppler effect we would need to create an outgoing signal and manipulate it when reflected based on the $\Delta f$ and calculate radial velocity ($$v = \frac{\Delta f \cdot c}{2 \cdot f_0}$$).

Tracking Computer: Sorts out the points returned: Points must be clustered together (is that one track or just a bigger in front of a smaller). Here we must use CENTROIDING to calculate a central point for track generation. And then check distance and speed of the objects with Fast Fourier Transform to separate contacts near each other or behind each other. To complete it, it has to generate a history of the tracked items and check also for direction and speed.

The tracking computer then sends tracks that are rendered on the screen in the renderer.








TODO
Lint
Github action