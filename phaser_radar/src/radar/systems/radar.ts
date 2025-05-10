import { RadarOptions, Vector2 } from '../../types/index'
import { Target } from '../entities/target'
import { Track } from '../data/track'
import { ReturnSignal, Mode } from '../../types/index'
export class Radar {
    private nextTrackId: number = 1;
    private readonly MAX_TRACK_AGE = 3; // Maximum number of scans a track can be missing before being dropped
    private readonly CORRELATION_DISTANCE = 50; // Maximum distance for track correlation
    private readonly CONFIDENCE_THRESHOLD = 0.5; // Minimum confidence to maintain a track
    private readonly STT_BEAM_WIDTH = 5; // Beam width in degrees
    private readonly PREDICTION_TIME = 0.1; // Time to predict ahead in seconds

    constructor(
        private scene: Phaser.Scene,
        private clock: Phaser.Time.Clock, 
        private radarOptions: RadarOptions,
        private mode: Mode = 'rws',
        private targets: Target[],
        private radarBeam: Phaser.Geom.Line,
        private step: number = 0,
        private memory: (ReturnSignal | null)[] = [],
        private tracks: Track[] = [],
    ) {}

    setPulseDir(direction: Vector2) {
        this.radarOptions.pulseDir = direction
    }

    setPosition(pos: Vector2) {
        this.radarOptions.pos = pos
    }

    setRange(r: number) {
        this.radarOptions.range = r
    }

    setSensitivity(s: number) {
        this.radarOptions.sensitivity = s
    }

    addTarget(target: Target) {
        this.targets.push(target)
    }

    getTargets() {
        return this.targets
    }

    getTracks() {
        return this.tracks
    }

    setTracks(tracks: Track[]) {
        this.tracks = tracks
    }

    getMemory() {
        return this.memory
    }

    setMode(mode: Mode) {
        this.mode = mode
    }

    getMode() {
        return this.mode
    }

    findTargetByCircle(d: Phaser.Geom.Line): ReturnSignal | null {
        const origin = this.radarOptions.pos;
        let closest: ReturnSignal | null = null;
        let closestDist2 = Infinity;
      
        for (const t of this.targets) {
          const circle = new Phaser.Geom.Circle(t.position.x, t.position.y, t.size);
      
          // This gives you **up to two** intersection points
          const hits = Phaser.Geom.Intersects.GetLineToCircle(d, circle);
      
          if (hits) {
            for (const hit of hits) {
              const dist2 = Phaser.Math.Distance.Squared(origin.x, origin.y, hit.x, hit.y);
      
              if (dist2 < closestDist2) {
                closestDist2 = dist2;
                closest = {
                  point: hit,
                  time: this.clock.now,
                  step: this.step,
                  direction: t.direction,
                  speed: t.speed,
                  distance: Math.round(dist2),
                };
              }
            }
          }
        }

        // if (closest) {
        //     const marker = this.scene.add.circle(closest.point.x, closest.point.y, 2, 0xff0000);
        //     marker.setOrigin(0.5);
        //     this.scene.tweens.add({
        //         targets: marker,
        //         alpha: 0,
        //         duration: 3500,
        //         onComplete: () => marker.destroy()
        //     });
        // }

        return closest;
      }
      

    transceive(d: Phaser.Geom.Line): ReturnSignal | null {
        return this.findTargetByCircle(d)
    }

    processReturnSignal(rs: ReturnSignal | null) {
        // collect returns and remove old ones
        if (rs) {
            this.memory[this.step] = rs
        }
        if (!rs) {
            this.memory[this.step] = null
        }
    }

    private correlateTracks(newTracks: Track[]): Track[] {
        const currentTime = this.clock.now;
        const correlatedTracks: Track[] = [];
        
        // Update existing tracks
        for (const existingTrack of this.tracks) {
            let bestMatch: Track | null = null;
            let bestDistance = Infinity;
            
            // Find the closest new track to this existing track
            for (const newTrack of newTracks) {
                const distance = Phaser.Math.Distance.Between(
                    existingTrack.pos.x,
                    existingTrack.pos.y,
                    newTrack.pos.x,
                    newTrack.pos.y
                );
                
                if (distance < this.CORRELATION_DISTANCE && distance < bestDistance) {
                    bestDistance = distance;
                    bestMatch = newTrack;
                }
            }
            
            if (bestMatch) {
                // Update existing track with new data
                const updatedTrack: Track = {
                    ...existingTrack,
                    pos: bestMatch.pos,
                    dist: bestMatch.dist,
                    dir: bestMatch.dir,
                    speed: bestMatch.speed,
                    age: existingTrack.age + 1,
                    lastUpdate: currentTime,
                    confidence: Math.min(1, existingTrack.confidence + 0.1) // Increase confidence
                };
                correlatedTracks.push(updatedTrack);
                
                // Remove the matched track from newTracks
                const index = newTracks.indexOf(bestMatch);
                if (index > -1) {
                    newTracks.splice(index, 1);
                }
            } else {
                // Track wasn't updated this scan
                if (existingTrack.age < this.MAX_TRACK_AGE) {
                    // Keep the track but increase its age
                    correlatedTracks.push({
                        ...existingTrack,
                        age: existingTrack.age + 1,
                        confidence: Math.max(0, existingTrack.confidence - 0.1) // Decrease confidence
                    });
                }
            }
        }
        
        // Add new tracks that weren't correlated
        for (const newTrack of newTracks) {
            correlatedTracks.push({
                ...newTrack,
                id: this.nextTrackId++,
                age: 0,
                lastUpdate: currentTime,
                confidence: 0.5
            });
        }
        
        // Filter out low confidence tracks
        return correlatedTracks.filter(track => track.confidence >= this.CONFIDENCE_THRESHOLD);
    }

    generateTracks() {
        // loop all return signals and cluster them
        let buffer = []
        let tracksBuffer: Track[] = []

        for (let i = 0; i < this.memory.length; i++) {
            const rs = this.memory[i]
            const rsMinusOne = this.memory[i - 1]
            if (!rs && !rsMinusOne) continue
            const distanceToLastIndex = Phaser.Math.Distance.Squared(rs?.point?.x!, rs?.point.y!, rsMinusOne?.point.x!, rsMinusOne?.point.y!)
            
            if (!rsMinusOne && rs) {
                buffer.push(rs)
            }
            if (rs && rsMinusOne) {
                if (distanceToLastIndex < this.radarOptions.sensitivity) {
                    buffer.push(rs)
                } else {
                    const b = buffer.reduce((acc, curr) => {
                        acc.x += curr.point.x
                        acc.y += curr.point.y
                        return acc
                    }, {x: 0, y: 0})
                    tracksBuffer.push({ 
                        id: 0, // Will be set during correlation
                        pos: { x: b.x / buffer.length, y: b.y / buffer.length}, 
                        dist: rs.distance, 
                        dir: rs.direction,
                        speed: rs.speed,
                        age: 0,
                        lastUpdate: this.clock.now,
                        confidence: 0.5
                    })
                    buffer = []
                }
            }
            if (!rs && rsMinusOne) {
                const b = buffer.reduce((acc, curr) => {
                    acc.x += curr.point.x
                    acc.y += curr.point.y
                    return acc
                }, {x: 0, y: 0})
                tracksBuffer.push({ 
                    id: 0, // Will be set during correlation
                    pos: { x: b.x / buffer.length, y: b.y / buffer.length}, 
                    dist: rsMinusOne.distance, 
                    dir: rsMinusOne.direction,
                    speed: rsMinusOne.speed,
                    age: 0,
                    lastUpdate: this.clock.now,
                    confidence: 0.5
                })
                buffer = []
            }
        }

        // Correlate new tracks with existing tracks
        this.tracks = this.correlateTracks(tracksBuffer);

        // Sort tracks by distance
        this.tracks.sort((a, b) => {
            if (a.dist < b.dist) return -1;
            if (a.dist > b.dist) return 1;
            return 0;
        });

        // Visualize tracks
        for (const tb of this.tracks) {
            const marker = this.scene.add.circle(tb.pos.x, tb.pos.y, 3, 0x00ff00);
            const indexText = this.scene.add.text(tb.pos.x, tb.pos.y + 15, `${tb.id}`, {
                fontSize: '15px',
                color: '#00ff00',
            });
            indexText.setOrigin(0.5);
            marker.setOrigin(0.5);

            this.scene.tweens.add({
                targets: [marker, indexText],
                alpha: 0,
                duration: 8000,
                onComplete: () => {
                    marker.destroy();
                    indexText.destroy();                
                }
            });
        }
    } 

    start() {
        this.radarOptions.isScanning = true
        this.radarBeam.setTo(
            this.radarOptions.pos?.x,
            this.radarOptions.pos?.y,
            this.radarOptions.pos?.x! + this.radarOptions.pulseDir?.x! * this.radarOptions.range!,
            this.radarOptions.pos?.y! + this.radarOptions.pulseDir?.y! * this.radarOptions.range!
        )
    }

    stop() {
        this.radarOptions.isScanning = false
    }

    render() {}

    private formatBearing(angle: number): string {
        // Convert angle to degrees and ensure it's between 0 and 360
        const degrees = (angle * 180 / Math.PI + 360) % 360;
        // Format as 3 digits with leading zeros
        return Math.round(degrees).toString().padStart(3, '0');
    }

    private formatRange(distance: number): string {
        // Convert to kilometers and format to 2 decimal places
        const km = distance / 1000;
        return km.toFixed(2);
    }

    private predictTargetPosition(track: Track): Vector2 {
        // Predict target position based on current position, direction, and speed
        return {
            x: track.pos.x + track.dir.x * track.speed * this.PREDICTION_TIME,
            y: track.pos.y + track.dir.y * track.speed * this.PREDICTION_TIME
        };
    }

    update() {
        if (!this.radarOptions.isScanning) {
            return
        }
        if (!this.radarBeam) {
            console.error('Radar beam not set')
            return
        }
        if (!this.radarOptions.pos) {
            console.error('Radar position not set')
            return
        }
        if (!this.radarOptions.range) {
            console.error('Radar range not set')
            return
        }
        if (!this.radarOptions.pulseDir) {
            console.error('Radar direction not set')
            return
        }

        if (this.mode === 'rws') {
            // Calculate the angle for this step (1 degree per update)
            const angle = Phaser.Math.DegToRad(this.step);
            
            // Calculate the end point of the beam using trigonometry
            const endX = this.radarOptions.pos.x + Math.cos(angle) * this.radarOptions.range;
            const endY = this.radarOptions.pos.y + Math.sin(angle) * this.radarOptions.range;
            
            // Update the radar beam position
            this.radarBeam.setTo(
                this.radarOptions.pos.x,
                this.radarOptions.pos.y,
                endX,
                endY
            );

            // Process the return signal
            const rs = this.transceive(this.radarBeam);
            this.processReturnSignal(rs);

            // Generate tracks after completing a full scan (360 degrees)
            if (this.step === 359) {
                this.generateTracks();
            }

            // Increment step and reset after 360 degrees
            this.step = (this.step + 1) % 360;
        } else if (this.mode === 'stt') {
            // In STT mode, we need at least one track
            if (this.tracks.length === 0) {
                console.warn('No tracks available for STT mode');
                return;
            }

            // Get the nearest track (tracks are already sorted by distance)
            const targetTrack = this.tracks[0];

            // Predict target position
            const predictedPos = this.predictTargetPosition(targetTrack);

            // Calculate angle to predicted target position
            const dx = predictedPos.x - this.radarOptions.pos.x;
            const dy = predictedPos.y - this.radarOptions.pos.y;
            const targetAngle = Math.atan2(dy, dx);

            // Calculate beam width angles
            const beamWidthRad = Phaser.Math.DegToRad(this.STT_BEAM_WIDTH);
            const leftAngle = targetAngle - beamWidthRad;
            const rightAngle = targetAngle + beamWidthRad;

            // Update radar beam to cover the beam width
            const leftX = this.radarOptions.pos.x + Math.cos(leftAngle) * this.radarOptions.range;
            const leftY = this.radarOptions.pos.y + Math.sin(leftAngle) * this.radarOptions.range;
            const rightX = this.radarOptions.pos.x + Math.cos(rightAngle) * this.radarOptions.range;
            const rightY = this.radarOptions.pos.y + Math.sin(rightAngle) * this.radarOptions.range;

            // Draw the beam width visualization
            const beamGraphics = this.scene.add.graphics();
            beamGraphics.lineStyle(1, 0xff0000, 0.3);
            beamGraphics.beginPath();
            beamGraphics.moveTo(this.radarOptions.pos.x, this.radarOptions.pos.y);
            beamGraphics.lineTo(leftX, leftY);
            beamGraphics.lineTo(rightX, rightY);
            beamGraphics.closePath();
            beamGraphics.strokePath();
            beamGraphics.fillPath();

            // Fade out the beam visualization
            this.scene.tweens.add({
                targets: beamGraphics,
                alpha: 0,
                duration: 100,
                onComplete: () => beamGraphics.destroy()
            });

            // Update radar beam to point at predicted target
            const endX = this.radarOptions.pos.x + Math.cos(targetAngle) * this.radarOptions.range;
            const endY = this.radarOptions.pos.y + Math.sin(targetAngle) * this.radarOptions.range;
            
            this.radarBeam.setTo(
                this.radarOptions.pos.x,
                this.radarOptions.pos.y,
                endX,
                endY
            );

            // Process the return signal
            const rs = this.transceive(this.radarBeam);
            this.processReturnSignal(rs);

            // Update the track immediately with new data
            if (rs) {
                // Update the track with new position and data
                targetTrack.pos = rs.point;
                targetTrack.dist = rs.distance;
                targetTrack.dir = rs.direction;
                targetTrack.speed = rs.speed;
                targetTrack.lastUpdate = this.clock.now;
                targetTrack.confidence = Math.min(1, targetTrack.confidence + 0.1);

                // Calculate bearing and range
                const bearing = this.formatBearing(targetAngle);
                const range = this.formatRange(targetTrack.dist);

                // Visualize the track update
                const marker = this.scene.add.circle(targetTrack.pos.x, targetTrack.pos.y, 3, 0xff0000); // Red for STT
                
                // Create a container for the text elements
                const textContainer = this.scene.add.container(targetTrack.pos.x, targetTrack.pos.y + 15);
                
                // Add track ID
                const idText = this.scene.add.text(0, 0, `STT-${targetTrack.id}`, {
                    fontSize: '15px',
                    color: '#ff0000',
                }).setOrigin(0.5, 0.5);
                
                // Add bearing and range info
                const infoText = this.scene.add.text(0, 20, `${bearing}° ${range}km`, {
                    fontSize: '12px',
                    color: '#ff0000',
                }).setOrigin(0.5, 0.5);
                
                // Add speed info
                const speedText = this.scene.add.text(0, 35, `${targetTrack.speed.toFixed(1)}m/s`, {
                    fontSize: '12px',
                    color: '#ff0000',
                }).setOrigin(0.5, 0.5);

                // Add all text elements to the container
                textContainer.add([idText, infoText, speedText]);

                // Animate the container
                this.scene.tweens.add({
                    targets: [marker, textContainer],
                    alpha: 0,
                    duration: 500,
                    onComplete: () => {
                        marker.destroy();
                        textContainer.destroy();
                    }
                });
            }
        }
    }
}