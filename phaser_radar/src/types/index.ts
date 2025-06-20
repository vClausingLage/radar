export type ReturnSignal = {
    point: Vector2
    time: number
    step: number
    direction: Vector2
    speed: number
    distance: number
}

export type Vector2 = {
    x: number
    y: number

    setTo?(): (x: number, y: number) => Vector2
}

export type RadarOptions = {
    range: number
    position: Vector2
    isScanning: boolean
    azimuth: number
    scanSpeed: number,
}

export type Mode = 'stt' | 'rws' | 'tws' | 'emcon'