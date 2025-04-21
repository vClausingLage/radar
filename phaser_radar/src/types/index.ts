export type ReturnSignal = {
    point: Vector2
    time: number
}

export type Vector2 = {
    x?: number
    y?: number

    setTo?(): (x: number, y: number) => Vector2
}