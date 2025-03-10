import { WorldMap } from "./map.ts"
import { Target } from "./target.ts"
import { Vector2 } from "./vector2.ts"
import { Radar } from "./radar.ts"

const m = new WorldMap(10, [])
const t1 = new Target(new Vector2(5, 1), new Vector2(1, 0), 1)
const t2 = new Target(new Vector2(5, 9), new Vector2(0, -1), 1)
m.addTargets([t1, t2])

const r = new Radar(m)
r.search()

Deno.serve({port: 4041}, (req) => {
  if (req.headers.get("upgrade") != "websocket") {
    return new Response(null, { status: 501 })
  }
  const { socket, response } = Deno.upgradeWebSocket(req)
  socket.addEventListener("open", () => {
    console.log("a client connected!")
  })
  socket.addEventListener("message", (event) => {
    if (event.data === "ping") {
      socket.send("pong")
    }
  })
  return response
})