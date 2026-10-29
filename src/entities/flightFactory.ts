import Phaser from 'phaser';
import { Flight } from '../controller/flight';
import { formationSettings } from '../settings';

/* eslint-disable @typescript-eslint/no-namespace */

// A two-ship element of cruisers. `x`/`y` is the lead; the wing is placed on
// its station, `wingSide` of the lead (+1 right, -1 left). `brain` is the
// lead's - Jev or the scripted doctrine, as for any cruiser; the wingman is
// always scripted, since only the lead is asked for tactical judgement.
export type FlightParams = {
  x: number;
  y: number;
  direction: number;
  speed: number;
  brain?: 'scripted' | 'jev';
  wingSide?: 1 | -1;
};

declare global {
  namespace Phaser.GameObjects {
    interface GameObjectFactory {
      flight(params: FlightParams): Flight;
    }
  }
}

export const createFlightFactory = () => {
  Phaser.GameObjects.GameObjectFactory.register('flight', function(
    this: Phaser.GameObjects.GameObjectFactory,
    params: FlightParams
  ) {
    const wingSide = params.wingSide ?? 1;
    const lead = this.target({
      x: params.x,
      y: params.y,
      direction: params.direction,
      speed: params.speed,
      type: 'cruiser',
      brain: params.brain,
    });

    // Start the wing on its station so the flight spawns already in formation.
    const headingRad = Phaser.Math.DegToRad(params.direction);
    const fx = Math.cos(headingRad);
    const fy = Math.sin(headingRad);
    const wing = this.target({
      x: params.x - fy * wingSide * formationSettings.SPACING_PX - fx * formationSettings.TRAIL_PX,
      y: params.y + fx * wingSide * formationSettings.SPACING_PX - fy * formationSettings.TRAIL_PX,
      direction: params.direction,
      speed: params.speed,
      type: 'cruiser',
      brain: 'scripted',
    });

    const flight = new Flight({ lead, wing, wingSide });
    // Both terminals join the one net; the wiring lives here, not in the
    // ships, like every other attachment (radar renderers, controllers).
    lead.radar.setDatalink(flight.datalink);
    wing.radar.setDatalink(flight.datalink);
    lead.controller?.joinFlight(flight, 'lead');
    wing.controller?.joinFlight(flight, 'wing');
    return flight;
  });
};
