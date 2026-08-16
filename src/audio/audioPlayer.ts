// Plays short voice clips stitched into a single radio call, one clip after the
// next. Only one message plays at a time — the player is "locked" while a call
// is in flight — and a global cooldown throttles messages so callouts never
// spam. Built generic so future audio (warnings, lock tones, …) can share the
// same lock and cooldown.
import Phaser from 'phaser';

export class AudioPlayer {
  private playing = false;
  private lastMessageAt = -Infinity;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cooldownMs = 30000,
  ) {}

  isPlaying(): boolean {
    return this.playing;
  }

  // Attempt to play a message built from the given clip keys, in order. Returns
  // false (and plays nothing) if a message is already playing or the cooldown
  // has not yet elapsed. `onComplete` fires once the last clip has finished —
  // only when the message was actually accepted (i.e. this returned true), so a
  // caller chaining off it must handle the rejected case itself.
  playMessage(keys: string[], onComplete?: () => void): boolean {
    if (this.playing || keys.length === 0) return false;
    const now = this.scene.time.now;
    if (now - this.lastMessageAt < this.cooldownMs) return false;

    this.lastMessageAt = now;
    this.playing = true;
    console.info(`AudioPlayer: playing message ${keys.join(', ')}`);
    this.playClip(keys, 0, onComplete);
    return true;
  }

  // Play keys[index], then chain to the next on completion. Unlocks when the
  // sequence finishes. A missing clip is skipped rather than stalling the queue,
  // so the lock can never stick.
  private playClip(keys: string[], index: number, onComplete?: () => void): void {
    if (index >= keys.length) {
      this.playing = false;
      onComplete?.();
      return;
    }

    const key = keys[index];
    if (!this.scene.cache.audio.exists(key)) {
      this.playClip(keys, index + 1, onComplete);
      return;
    }

    const sound = this.scene.sound.add(key);
    sound.once('complete', () => {
      sound.destroy();
      this.playClip(keys, index + 1, onComplete);
    });
    sound.play();
  }
}
