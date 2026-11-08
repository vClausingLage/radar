// The extent of a scene's world in px, from (0, 0). Each scene sets its own:
// the practice scenarios fly the default square, the campaign a bigger theatre.
export type WorldSize = {
    width: number
    height: number
}

export type Vector2 = {
    x: number
    y: number

    setTo?(): (x: number, y: number) => Vector2
}
