import { usePiano } from '../lib/usePiano'
import { PianoContextProvider } from '../lib/PianoContext'

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
