import { Piano } from "@tonejs/piano";
import { createContext, ReactNode, useState, useEffect } from "react";
import * as Tone from "tone";

type PianoStatus = 'loading' | 'done' | 'error' | undefined;
interface PianoContextProps {
  piano?: Piano;
  status: PianoStatus;
}
export const PianoContext = createContext<PianoContextProps | undefined>(undefined);
interface PianoContextProviderProps {
  velocities?: number;
  children: ReactNode;
}

export const PianoContextProvider = ({ velocities, children }: PianoContextProviderProps) => {
  const [piano, setPiano] = useState<Piano>();
  const [status, setStatus] = useState<PianoStatus>();

  useEffect(() => {
    let withDestination: Piano;
    try {
      const context = new Tone.Context();
      Tone.setContext(context);

      const initializedPiano = new Piano({
        velocities: velocities || 5,
      });

      (async () => {
        setStatus('loading');
        await initializedPiano.load();
        setStatus('done');
      })();

      withDestination = initializedPiano.toDestination();
      setPiano(withDestination);
    }
    catch (e) {
      console.error(e);
      setStatus('error');
    }

    return () => {
      withDestination.disconnect();
    };
  }, [velocities]);

  return (
    <PianoContext.Provider value={{ piano, status }}>
      {children}
    </PianoContext.Provider>
  );
};
