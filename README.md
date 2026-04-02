# react-pianosound

React hooks for playing MIDI files through a sampled piano (via [Tone.js](https://tonejs.github.io/) and [@tonejs/piano](https://github.com/tambien/Piano)) or a connected hardware MIDI output. Handles sample loading, sustain/soft pedal, and transport control.

## Install

```sh
npm install react-pianosound
```

Peer dependencies: `react` and `react-dom` 19+.

## Usage

```tsx
import { PianoContextProvider, usePiano } from "react-pianosound";

function App() {
  return (
    <PianoContextProvider velocities={5}>
      <Player />
    </PianoContextProvider>
  );
}

function Player() {
  const { status, play, stop, playSingleNote, device } = usePiano();

  if (status === "loading") return <p>Loading samples...</p>;

  return (
    <>
      <p>Output: {device}</p>
      <button onClick={() => playSingleNote(60)}>Play Middle C</button>
      <button onClick={() => stop()}>Stop</button>
    </>
  );
}
```

`play(midiFile)` accepts a parsed `MidiFile` (from [midifile-ts](https://github.com/ryohey/midifile-ts)) and schedules all events on the Tone.js transport. If a hardware MIDI output is detected, events are routed there instead.

## API

### `<PianoContextProvider velocities?={number}>`

Initializes the piano sampler. `velocities` controls how many velocity layers are loaded (default 5).

### `usePiano()`

Returns:

| Field | Description |
|---|---|
| `status` | `'loading'` \| `'done'` \| `'error'` \| `undefined` |
| `play(file, cb?)` | Schedule and start MIDI playback |
| `stop()` | Stop playback, release all notes |
| `playSingleNote(pitch, durationMs?, velocity?)` | Play a single MIDI note |
| `jumpTo(seconds)` | Seek the transport |
| `device` | Name of the active output (`'synthetic'` or hardware name) |

### `usePianoEvents(listener)`

Subscribe to playback events. The listener receives `{ event, transportSeconds }` for every scheduled MIDI event during playback.

## License

MIT
