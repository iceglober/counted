"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

// Carry the once-shown key across the creation redirect in memory only.
// It disappears on reload or navigation away from the destination project.
const SetupKeyContext = createContext({
  key: "",
  prepare: (_path: string, _secret: string) => {},
});
export function SetupKeyProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState<{
    from: string;
    to: string;
    secret: string;
  } | null>(null);
  useEffect(() => {
    if (pending && pathname !== pending.from && pathname !== pending.to)
      setPending(null);
    else if (
      pending &&
      pathname === pending.to &&
      pending.from !== pending.to
    ) {
      setPending({ ...pending, from: pending.to });
    }
  }, [pathname, pending]);
  return (
    <SetupKeyContext.Provider
      value={{
        key: pending?.to === pathname ? pending.secret : "",
        prepare: (to, secret) => setPending({ from: pathname, to, secret }),
      }}
    >
      {children}
    </SetupKeyContext.Provider>
  );
}
export const useSetupKey = () => useContext(SetupKeyContext);
