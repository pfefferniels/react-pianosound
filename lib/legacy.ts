import { MIDIControlEvents, MidiFile } from "midifile-ts";

export function midiTickToMilliseconds(ticks: number, microsecondsPerBeat: number, ppq: number): number {
    // Calculate how many beats the given number of ticks represent
    const beats = ticks / ppq;

    // Convert beats to milliseconds
    const milliseconds = (beats * microsecondsPerBeat) / 1000;

    return milliseconds;
}

export interface Event<T> {
    type: T
    id: string
    onset: number
    offset: number
    onsetMs: number
    offsetMs: number
    channel: number
}

export interface MidiNote extends Event<'note'> {
    id: string;
    pitch: number;
    velocity: number;
    channel: number;

    onsetMs: number;
    offsetMs: number;
}

export interface MidiPedal extends Event<'pedal'> {
}

export const asNotes = (file: MidiFile) => {
    type Tempo = { atTick: number; microsecondsPerBeat: number; };
    const tempoMap: Tempo[] = [];
    const newNotes: (MidiNote | MidiPedal)[] = [];
    const currentNotes: (MidiNote | MidiPedal)[] = [];
    for (let i = 0; i < file.tracks.length; i++) {
        const track = file.tracks[i];
        let currentTime = 0;
        for (const event of track) {
            currentTime += event.deltaTime;
            if (event.type === 'meta' && event.subtype === 'setTempo') {
                tempoMap.push({
                    atTick: currentTime,
                    microsecondsPerBeat: event.microsecondsPerBeat
                });
            }
            else if (event.type === 'channel' && event.subtype === 'noteOn') {
                const currentTempo = tempoMap.slice().reverse().find(tempo => tempo.atTick <= currentTime);
                if (!currentTempo) {
                    console.log('No tempo event found. Skipping');
                    continue;
                }

                currentNotes.push({
                    type: 'note',
                    id: `${i}-${currentTime}-${event.noteNumber}`,
                    onset: currentTime,
                    offset: 0,
                    velocity: event.velocity,
                    pitch: event.noteNumber,
                    channel: i,
                    onsetMs: midiTickToMilliseconds(currentTime, currentTempo.microsecondsPerBeat, file.header.ticksPerBeat),
                    offsetMs: 0
                });
            }
            else if (event.type === 'channel'
                && event.subtype === 'controller'
                && event.controllerType === MIDIControlEvents.SUSTAIN) {
                const currentTempo = tempoMap.slice().reverse().find(tempo => tempo.atTick <= currentTime);
                if (!currentTempo) {
                    console.log('No tempo event found. Skipping');
                    continue;
                }

                if (event.value <= 63) {
                    // pedal off
                    const pendingPedal = newNotes.find(note => note.type === 'pedal' && note.offset === 0);
                    if (!pendingPedal) {
                        console.log('No pending pedal found for pedal off-event')
                        continue
                    }

                    pendingPedal.offset = currentTime;
                    pendingPedal.offsetMs = midiTickToMilliseconds(currentTime, currentTempo.microsecondsPerBeat, file.header.ticksPerBeat)
                }
                else {
                    // pedal on
                    newNotes.push({
                        type: 'pedal',
                        id: `${i}-${currentTime}-pedal`,
                        onset: currentTime,
                        offset: 0,
                        channel: i,
                        onsetMs: midiTickToMilliseconds(currentTime, currentTempo.microsecondsPerBeat, file.header.ticksPerBeat),
                        offsetMs: 0
                    })
                }
            }
            else if (event.type === 'channel' && event.subtype === 'noteOff') {
                const currentTempo = tempoMap.slice().reverse().find(tempo => tempo.atTick <= currentTime);
                if (!currentTempo) {
                    console.log('No tempo event found. Skipping');
                    continue;
                }
                const samePitchNotes = currentNotes.filter(note => note.type === 'note' && note.pitch === event.noteNumber);

                if (!samePitchNotes.length) {
                    console.log('Found a note-off event without a previous note-on.');
                    continue;
                }

                if (samePitchNotes.length === 2) {
                    // Please the offset 1 tick before the next onset
                    samePitchNotes[0].offset = samePitchNotes[1].onset - 1
                    samePitchNotes[0].offsetMs = midiTickToMilliseconds(samePitchNotes[1].onset - 1, currentTempo.microsecondsPerBeat, file.header.ticksPerBeat)
                    newNotes.push(samePitchNotes[0])
                    currentNotes.splice(currentNotes.indexOf(samePitchNotes[0]), 1);
                    continue;
                }

                samePitchNotes[0].offset = currentTime;
                samePitchNotes[0].offsetMs = midiTickToMilliseconds(currentTime, currentTempo.microsecondsPerBeat, file.header.ticksPerBeat)
                newNotes.push(samePitchNotes[0]);
                currentNotes.splice(currentNotes.indexOf(samePitchNotes[0]), 1);
            }
        }
    }

    return newNotes.sort((a, b) => a.onset - b.onset);
};
