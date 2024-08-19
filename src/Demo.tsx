import { PianoContextProvider, usePiano } from '../lib/usePiano'

const Keyboard = () => {
  const { playSingleNote } = usePiano()

  return (
    <button onClick={() => playSingleNote(62)}>Play Note</button>
  )
}

function Demo() {
  return (
    <PianoContextProvider>
      <Keyboard />
    </PianoContextProvider>
  )
}

export default Demo
