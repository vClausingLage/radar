interface IRadar {
  transceive(): void;
}

export class Radar implements IRadar {
  transceive(): void {
    console.log('Transceiving radar signal...');
  }
}