import { Vector2 } from './vector2.ts'
import { assertEquals } from "jsr:@std/assert"

const v = new Vector2(1, 2)
const v2 = new Vector2(3, 4)

Deno.test("add two vectors", () => {
    const result = v.add(v2)
    assertEquals(result, new Vector2(4, 6))
})