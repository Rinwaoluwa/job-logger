import { createContext, useContext } from "react";

// Views stay mounted when their tab is hidden (see App.jsx). This tells a
// component inside one whether its tab is the one on screen, so it can
// hold off polling, refetching and keyboard shortcuts until it is back.
// Defaults to true, so anything rendered outside a pane behaves as before.
export const ActiveViewContext = createContext(true);

export function useIsActiveView() {
  return useContext(ActiveViewContext);
}
