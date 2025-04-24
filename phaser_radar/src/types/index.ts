export type ReturnSignal = {
    point: Vector2
    time: number
    step: number
}

export type Vector2 = {
    x: number
    y: number

    setTo?(): (x: number, y: number) => Vector2
}

export type RadarSettings = {
    range: number
    pulseDir: Vector2
    sensitivity: number
    pos: Vector2
    isScanning: boolean
    aperture: 360 | 90 | 45 | 30
  }