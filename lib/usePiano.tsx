import { useContext } from 'react';
import * as Tone from 'tone'
import { AnyEvent, MIDIControlEvents, MidiFile } from 'midifile-ts';
import { addAbsoluteTime } from './MidiNote';
import { PianoContext } from './PianoContext';

function convertRange(value: number, r1: [number, number], r2: [number, number]) {
  return (value - r1[0]) * (r2[1] - r2[0]) / (r1[1] - r1[0]) + r2[0];
}

export type EventListener = (e: AnyEvent) => void

const isNoteOn = (event: AnyEvent) => event.type === 'channel' && event.subtype === 'noteOn'
const isNoteOff = (event: AnyEvent) => event.type === 'channel' && event.subtype === 'noteOff'

const isPedalOn = (event: AnyEvent) => (
  event.type === 'channel'
  && event.subtype === 'controller'
  && event.controllerType === MIDIControlEvents.SUSTAIN
  && event.value > 63
)

const isPedalOff = (event: AnyEvent) => (
  event.type === 'channel'
  && event.subtype === 'controller'
  && event.controllerType === MIDIControlEvents.SUSTAIN
  && event.value <= 63
)

const isSoftPedalOn = (event: AnyEvent) => {
  return event.type === 'channel'
    && event.subtype === 'controller'
    && event.controllerType === MIDIControlEvents.SOFT_PEDAL
    && event.value > 63
}

const isSoftPedalOff = (event: AnyEvent) => {
  return event.type === 'channel'
    && event.subtype === 'controller'
    && event.controllerType === MIDIControlEvents.SOFT_PEDAL
    && event.value <= 63
}

export const usePiano = () => {
  const context = useContext(PianoContext);
  if (!context) {
    throw new Error('usePiano must be used within a PianoContextProvider');
  }
  const { piano, status } = context
  const transport = Tone.getTransport()

  const play = (file: MidiFile, cb?: EventListener) => {
    if (!piano) {
      console.log('Piano not loaded yet')
      return
    }

    const events = addAbsoluteTime(file)
    piano.toDestination()

    const softRegions = events
      .reduce((arr, event) => {
        if (isSoftPedalOn(event)) {
          arr.push([event.abs, null])
        }
        else if (isSoftPedalOff(event) && arr[arr.length - 1]) {
          arr[arr.length - 1][1] = event.abs
        }
        return arr
      }, new Array<[number, number | null]>())

    for (const event of events) {
      const insideSoft = softRegions.findIndex(region => region[0] < event.abs && region[1] !== null && region[1] > event.abs) !== -1

      transport.schedule((time) => {
        cb && cb(event)

        if (isNoteOn(event)) {
          piano.keyDown({
            note: event.noteNumber.toString(),
            velocity:
              convertRange(event.velocity, [0, 127], [0, 1]) * (insideSoft ? 0.67 : 1),
            time
          });
        }
        else if (isNoteOff(event)) {
          piano.keyUp({
            note: event.noteNumber.toString(),
            time
          })
        }
        else if (isPedalOn(event)) {
          piano.pedalDown({
            time
          })
        }
        else if (isPedalOff(event)) {
          piano.pedalUp({
            time
          })
        }
      }, event.abs / 1000)
    }

    if (transport.state === 'started') return
    Tone.start()
    transport.start()
  }

  const stopAll = () => {
    if (!piano) return

    transport.stop()
    transport.position = 0
    transport.cancel()
    piano.stopAll()
  }

  const playSingleNote = (pitch: number, durationMs: number = 500, velocity?: number) => {
    if (!piano) return
    
    piano.toDestination();
    piano.keyDown({
      note: pitch.toString(),
      velocity
    })

    // calling piano.keyUp() directly with the time parameter set to 0.5
    // will make the piano stop completely (for unknown reasons ...)
    setTimeout(() => {
      piano.keyUp({
        note: pitch.toString()
      })
    }, durationMs)
  };

  return {
    status,
    play,
    playSingleNote,
    stop: stopAll,
    seconds: transport.seconds,
    jumpTo: (seconds: number) => transport.seconds = seconds,
  };
};
