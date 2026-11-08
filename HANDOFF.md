# Übergabe: Doppler-Notch, Chaff gegen STT, RWR-Raketensymbole, größere Kampagne

Stand: 2026-11-08 (zweite Sitzung). Nichts ist committet. Diese Datei ist nur für die Übergabe, bitte löschen, sobald die offenen Punkte unten erledigt oder verworfen sind.

Was in der ersten Sitzung gebaut wurde, steht jetzt in den Docs (`CLAUDE.md` Signal-Path-Schritte 4/5, `docs/radar.md`, `docs/player.md`, `TO_DO.md`).

## Zweite Sitzung: Ursache der Flight-Regressionen und Fix

Ursache: Die KI wirft beim Übergang in ENGAGE Chaff (auf HEAD genauso). Die Wolke blüht jetzt am Heck (`SPAWN_AFT_PX`) und umschließt den eigenen Hull. Das eigene Radar sah die ersten Chaff-Zellen ein paar px vor der Antenne. Wegen R⁴ lagen sie weit über dem Rauschboden, auch durch die Notch, und die Schiffe trackten **sich selbst**. Diese Self-Tracks vergifteten Sort und Launch-on-Remote.

Zwei Korrekturen, beide nötig:
1. **STC** (`signalPath.stcRangePx`, `RADAR_STC_RANGE_PX` = 100, angewendet in `Receiver.echoSignal`): Innerhalb von 100 px ist ein Echo nicht lauter als derselbe Reflektor auf 100 px. Gilt nur für den Schiffs-/Dish-Empfänger, nicht für den Raketensucher.
2. **Notch-Schaltung** (`CfarDetector.notchGain`): Sie liest jetzt auch die eigene Clutter-Zelle, nicht nur das CFAR-Fenster ohne Guard Cell. Die eigene Wolke füllte fast nur diese eine Zelle.

Neuer Test: `A radar inside its own chaff cloud does not track itself`. Mit Fix 0/360 Frames, ohne Fix 333/360.

## Verifikation
- `tsc`, `eslint .`, `vite build`: sauber (Chunk-Warnung wie vorher).
- Sort + Wingman gefiltert, Seeds 113/1/7/42/99: 10/10 grün (HEAD: Wingman 3/5).
- Volle Suite Seed 113: 63/68. Die 5 Roten gefiltert über die Seeds 113/1/7 gegen HEAD: gleichwertig flaky (Stand 2 rote Ergebnisse, HEAD 2), keine Regression.
- Alle Chaff-, Notch-, RWR-, MTI- und Clutter-Tests grün.

## Offen
1. **Level 1 mit einem Menschen spielen.** Die Bots sterben an Felsen (alte Koordinaten bzw. kein Ausweichen), das ist kein Spielfehler. Ob ein Mensch es im größeren Theater schafft, ist ungetestet.
2. **Notch aus Spielersicht in Level 1:** Der Spieler hält einen Mule im Scree auf 300 px head-on und beam gleich gut (50–75 %). Die Clutter-Karte des Spielers ist dort zu dünn für `MTI_ACTIVATION_DENSITY`, nur Discos Dome verliert die Mules (etwa 50 %). Das Briefing sagt „Look from where they fly at you“. Das ist eine Design-/Tuning-Entscheidung.
3. **`l1-scree`-Funkzeile:** Im Bot (Sim etwa 8× Echtzeit) nie gesendet, weil der Funk in Sim-Zeit dauerbelegt ist. Die Verlust-Erkennung selbst greift. In Echtzeit nicht geprüft.
4. Audio: `l1-scree` und `l1-fail-unidentified` haben keine mp3 (`node tools/generateClips.js --only=...`, kostet). Fehlende Clips laufen als Untertitel. Die „Unable to decode audio data“-Exception ist nur der Loader.
5. L2/L3 nach dem Vergrößern nicht nachgemessen.
