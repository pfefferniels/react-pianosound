import { useContext, useEffect, useMemo, useState } from 'react';
import * as Tone from 'tone';
import { AnyEvent, MIDIControlEvents, MidiFile } from 'midifile-ts';
import { addAbsoluteTime } from './MidiNote';
import { PianoContext } from './PianoContext';

export type PianoPlaybackEvent = {
  event: AnyEvent;
  transportSeconds: number;
};

type Listener = (e: PianoPlaybackEvent) => void;
const __listeners = new Set<Listener>();

export function usePianoEvents(listener: Listener | null) {
  useEffect(() => {
    if (!listener) return;
    __listeners.add(listener);
    return () => { __listeners.delete(listener); };
  }, [listener]);
}

function emitPlaybackEvent(data: PianoPlaybackEvent) {
  for (const fn of __listeners) fn(data);
}

function convertRange(value: number, r1: [number, number], r2: [number, number]) {
  return (value - r1[0]) * (r2[1] - r2[0]) / (r1[1] - r1[0]) + r2[0];
}

export type EventListener = (e: AnyEvent) => void;

const isNoteOn = (e: AnyEvent) => e.type === 'channel' && e.subtype === 'noteOn';
const isNoteOff = (e: AnyEvent) => e.type === 'channel' && e.subtype === 'noteOff';

const isPedalOn = (e: AnyEvent) =>
  e.type === 'channel' &&
  e.subtype === 'controller' &&
  e.controllerType === MIDIControlEvents.SUSTAIN &&
  (e.value ?? 0) > 63;

const isPedalOff = (e: AnyEvent) =>
  e.type === 'channel' &&
  e.subtype === 'controller' &&
  e.controllerType === MIDIControlEvents.SUSTAIN &&
  (e.value ?? 0) <= 63;

const isSoftPedalOn = (e: AnyEvent) =>
  e.type === 'channel' &&
  e.subtype === 'controller' &&
  e.controllerType === MIDIControlEvents.SOFT_PEDAL &&
  (e.value ?? 0) > 63;

const isSoftPedalOff = (e: AnyEvent) =>
  e.type === 'channel' &&
  e.subtype === 'controller' &&
  e.controllerType === MIDIControlEvents.SOFT_PEDAL &&
  (e.value ?? 0) <= 63;

/* -------- Web MIDI helpers -------- */

type MIDIOutputLike = MIDIOutput | null;

function getFirstOutput(access: MIDIAccess | null): MIDIOutputLike {
  if (!access) return null;
  for (const output of access.outputs.values()) return output; // first one
  return null;
}

function statusNoteOn(channel: number) { return 0x90 | (channel & 0x0F); }
function statusNoteOff(channel: number) { return 0x80 | (channel & 0x0F); }
function statusCC(channel: number) { return 0xB0 | (channel & 0x0F); }
function statusPC(channel: number) { return 0xC0 | (channel & 0x0F); }

function eventChannel(e: AnyEvent): number {
  if (e.type === 'channel' && typeof e.channel === 'number') return e.channel & 0x0F;
  return 0; // default channel 1 (0-based)
}

// Map midifile-ts AnyEvent → 0..N Web MIDI short messages
function toMidiMessages(e: AnyEvent): Uint8Array[] {
  if (e.type !== 'channel') return [];
  const ch = eventChannel(e);
  switch (e.subtype) {
    case 'noteOn': {
      const vel = Math.max(0, Math.min(127, e.velocity ?? 64));
      return [new Uint8Array([statusNoteOn(ch), e.noteNumber & 0x7F, vel])];
    }
    case 'noteOff':
      return [new Uint8Array([statusNoteOff(ch), e.noteNumber & 0x7F, 0])];

    case 'controller': {
      const ctl = (e.controllerType ?? 0) & 0x7F;
      const val = (e.value ?? 0) & 0x7F;
      return [new Uint8Array([statusCC(ch), ctl, val])];
    }

    case 'programChange': {
      const pgm = (e.value ?? 0) & 0x7F;
      return [new Uint8Array([statusPC(ch), pgm])];
    }

    default:
      return [];
  }
}

export const usePiano = () => {
  const context = useContext(PianoContext);
  if (!context) throw new Error('usePiano must be used within a PianoContextProvider');
  const { piano, status } = context;

  const [, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [midiOutput, setMidiOutput] = useState<MIDIOutputLike>(null);

  const transport = Tone.getTransport();
  const usingHardware = useMemo(() => !!midiOutput, [midiOutput]);

  // Init Web MIDI (once) and keep the first output selected.
  useEffect(() => {
    let cancelled = false; // FIX: make mutable and set true in cleanup
    let removeListener: (() => void) | undefined;

    (async () => {
      if (!navigator.requestMIDIAccess) return;
      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        if (cancelled) return;

        setMidiAccess(access);
        setMidiOutput(getFirstOutput(access));

        const onChange = () => setMidiOutput(getFirstOutput(access));
        access.addEventListener('statechange', onChange);
        removeListener = () => access.removeEventListener('statechange', onChange);
      } catch {
        // no MIDI available; fine -> fall back to Tone
      }
    })();

    return () => {
      cancelled = true;     // FIX: actually cancel pending setState
      removeListener?.();
      // ensure no stray scheduled callbacks
      transport.stop();
      transport.position = 0;
      transport.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleEvents = (file: MidiFile, cb?: EventListener) => {
    const events = addAbsoluteTime(file);

    // Precompute soft-pedal velocity scaling regions for Tone path
    const softRegions = events.reduce((arr, ev) => {
      if (isSoftPedalOn(ev)) {
        arr.push([ev.abs, null as number | null]);
      } else if (isSoftPedalOff(ev) && arr.length && arr[arr.length - 1][1] === null) {
        arr[arr.length - 1][1] = ev.abs;
      }
      return arr;
    }, new Array<[number, number | null]>());

    // Reset transport **before** scheduling
    transport.stop();
    transport.position = 0;
    transport.cancel();

    if (usingHardware) {
      // Hardware: schedule message sends
      for (const ev of events) {
        transport.schedule(() => {
          cb?.(ev);
          emitPlaybackEvent({
            event: ev,
            transportSeconds: transport.seconds,
          });
          
          const msgs = toMidiMessages(ev);
          for (const msg of msgs) {
            midiOutput!.send(Array.from(msg));
          }
        }, ev.abs / 1000);
      }
    } else {
      // Tone path
      if (!piano) {
        // This log used to appear because play() started transport first,
        // then scheduleEvents() bailed out and never restarted.
        console.warn('Piano not loaded yet');
        return;
      }
      piano.toDestination();

      for (const ev of events) {
        const insideSoft =
          softRegions.findIndex(([start, end]) => start < ev.abs && end !== null && end! > ev.abs) !== -1;

        transport.schedule((time) => {
          cb?.(ev);
          emitPlaybackEvent({
            event: ev,
            transportSeconds: transport.seconds,
          });

          if (isNoteOn(ev)) {
            piano.keyDown({
              note: ev.noteNumber.toString(),
              velocity: convertRange(ev.velocity ?? 64, [0, 127], [0, 1]) * (insideSoft ? 0.67 : 1),
              time
            });
          } else if (isNoteOff(ev)) {
            piano.keyUp({ note: ev.noteNumber.toString(), time });
          } else if (isPedalOn(ev)) {
            piano.pedalDown({ time });
          } else if (isPedalOff(ev)) {
            piano.pedalUp({ time });
          }
        }, ev.abs / 1000);
      }
    }
  };

  const play = (file: MidiFile, cb?: EventListener) => {
    scheduleEvents(file, cb);

    if (transport.state !== 'started') {
      Tone.start()
      transport.start();
    }
  };

  const stopAll = () => {
    // Stop/cancel scheduled callbacks
    transport.stop();
    transport.position = 0;
    transport.cancel();

    if (usingHardware && midiOutput) {
      // Panic: sustain off + all notes off across channels
      for (let c = 0; c < 16; c++) {
        midiOutput.send([statusCC(c), 64, 0]);   // CC64 sustain off
        midiOutput.send([statusCC(c), 123, 0]);  // CC123 all notes off
      }
    } else if (piano) {
      piano.stopAll();
    }
  };

  const playSingleNote = (pitch: number, durationMs = 500, velocity?: number) => {
    if (usingHardware && midiOutput) {
      const c = 0;
      const vel = Math.max(0, Math.min(127, Math.round((velocity ?? 0.8) * 127)));

      midiOutput.send([statusNoteOn(c), pitch & 0x7F, vel]);
      window.setTimeout(() => {
        midiOutput.send([statusNoteOff(c), pitch & 0x7F, 0]);
      }, durationMs);
      // ensure sustain isn't latched
      midiOutput.send([statusCC(c), 64, 0]);
      return;
    }

    if (!piano) return;
    piano.toDestination();
    piano.keyDown({ note: pitch.toString(), velocity });
    setTimeout(() => piano.keyUp({ note: pitch.toString() }), durationMs);
  };

  const jumpTo = (seconds: number) => {
    transport.seconds = Math.max(0, seconds);
  };



  return {
    status,
    play,
    playSingleNote,
    stop: stopAll,
    jumpTo,
    device: midiOutput?.name ?? 'synthetic',
  };
};
