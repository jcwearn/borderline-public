/**
 * Golf sounds, synthesised.
 *
 * Every sound here is built from oscillators and filtered noise rather than
 * loaded from a file: no samples to license, no megabytes to ship, and every
 * character of every hit is a number you can edit.
 *
 * A struck golf ball is really two things at once — a bright transient click
 * from the face, and a short pitched body from the ball itself. Change the
 * balance between them and you move between a putter, an iron and a mishit.
 *
 * All of it is triggered by a player action, so the audio context is created on
 * first use and resumed then, which is what browsers require.
 */
import type { Outcome } from './game/rules'

export type Sound =
  /** A country named from memory. Clean, bright, free. */
  | 'place'
  /** A name bought off the globe. Heavier, duller — it cost something. */
  | 'reveal'
  /** A country that would not go. A mishit off the hosel. */
  | 'miss'
  /** The round closing. Rattle, drop, and a small lift. */
  | 'holed'

/**
 * Which club that swing was. Derived from the outcome rather than the call
 * site, so the sound can never disagree with what the game actually did — a
 * bought name always sounds like one.
 */
export function soundFor(outcome: Outcome): Sound | null {
  if (outcome.placed) return outcome.reveal ? 'reveal' : 'place'
  return outcome.miss ? 'miss' : null
}

let context: AudioContext | null = null
let master: GainNode | null = null
let muted = false

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === 'undefined') return null
  try {
    if (!context) {
      const Ctor =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      context = new Ctor()
      master = context.createGain()
      master.gain.value = 0.5
      master.connect(context.destination)
    }
    // Browsers start the context suspended until a gesture unlocks it.
    if (context.state === 'suspended') void context.resume()
    return { ctx: context, out: master! }
  } catch {
    // No audio hardware, or a policy that forbids it. Never worth an error.
    return null
  }
}

export function setMuted(value: boolean): void {
  muted = value
}

/** Short burst of white noise — the strike of face on ball. */
function hiss(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  {
    duration,
    level,
    freq,
    q = 1,
    type = 'bandpass',
  }: { duration: number; level: number; freq: number; q?: number; type?: BiquadFilterType },
) {
  const frames = Math.max(1, Math.ceil(ctx.sampleRate * duration))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) samples[i] = Math.random() * 2 - 1

  const source = ctx.createBufferSource()
  source.buffer = buffer

  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq
  filter.Q.value = q

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(level, at)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)

  source.connect(filter).connect(gain).connect(out)
  source.start(at)
  source.stop(at + duration)
}

/** Pitched body. `bend` drops the pitch across the note, as a struck ball does. */
function thock(
  ctx: AudioContext,
  out: GainNode,
  at: number,
  {
    freq,
    duration,
    level,
    type = 'triangle',
    bend = 1,
  }: {
    freq: number
    duration: number
    level: number
    type?: OscillatorType
    bend?: number
  },
) {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, at + duration)

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(level, at + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)

  osc.connect(gain).connect(out)
  osc.start(at)
  osc.stop(at + duration + 0.02)
}

export function play(sound: Sound): void {
  if (muted) return
  const rig = audio()
  if (!rig) return
  const { ctx, out } = rig
  const now = ctx.currentTime + 0.001

  switch (sound) {
    // Putter on a clean strike: bright, tight, over almost before it starts.
    case 'place':
      hiss(ctx, out, now, { duration: 0.035, level: 0.28, freq: 2600, q: 0.9 })
      thock(ctx, out, now, { freq: 420, duration: 0.09, level: 0.22, bend: 0.72 })
      break

    // A wedge taking a divot. Lower body, more noise, less click — the sound of
    // having paid for something.
    case 'reveal':
      hiss(ctx, out, now, { duration: 0.07, level: 0.22, freq: 1100, q: 0.7 })
      thock(ctx, out, now, { freq: 190, duration: 0.16, level: 0.26, bend: 0.6 })
      hiss(ctx, out, now + 0.02, { duration: 0.09, level: 0.1, freq: 500, type: 'lowpass' })
      break

    // Off the hosel: all thud, no ring, pitch falling away.
    case 'miss':
      hiss(ctx, out, now, { duration: 0.05, level: 0.16, freq: 320, type: 'lowpass' })
      thock(ctx, out, now, { freq: 150, duration: 0.11, level: 0.2, type: 'sine', bend: 0.5 })
      break

    // The ball rattling the cup, dropping, and settling — then a small lift,
    // because holing out should feel like something.
    case 'holed': {
      const rattle = [0, 0.055, 0.1, 0.135]
      rattle.forEach((offset, index) => {
        hiss(ctx, out, now + offset, {
          duration: 0.03,
          level: 0.16 - index * 0.03,
          freq: 2000 - index * 320,
          q: 2.2,
        })
        thock(ctx, out, now + offset, {
          freq: 700 - index * 90,
          duration: 0.05,
          level: 0.11,
          bend: 0.8,
        })
      })
      // Into the hole.
      thock(ctx, out, now + 0.2, { freq: 150, duration: 0.3, level: 0.3, type: 'sine', bend: 0.55 })
      hiss(ctx, out, now + 0.2, { duration: 0.16, level: 0.1, freq: 420, type: 'lowpass' })
      // A rising fifth, quiet enough to read as punctuation rather than fanfare.
      thock(ctx, out, now + 0.34, { freq: 523.25, duration: 0.22, level: 0.1, type: 'sine' })
      thock(ctx, out, now + 0.44, { freq: 783.99, duration: 0.34, level: 0.11, type: 'sine' })
      break
    }
  }
}
