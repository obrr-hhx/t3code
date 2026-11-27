import { createContext, use, useState, type ReactNode } from "react";
import * as Schema from "effect/Schema";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const PanelLayout = createContext<{
  open: boolean;
  wide: boolean;
  toggle: () => void;
  close: () => void;
} | null>(null);

export const useSuperAgentPanelLayout = () => use(PanelLayout);

export function SuperAgentPanelLayout({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const [desktopOpen, setDesktopOpen] = useLocalStorage(
    "herdr.manager-panel.open.v1",
    true,
    Schema.Boolean,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const open = wide ? desktopOpen : mobileOpen;
  const setOpen = wide ? setDesktopOpen : setMobileOpen;
  const value = active
    ? { open, wide, toggle: () => setOpen(!open), close: () => setOpen(false) }
    : null;
  return <PanelLayout value={value}>{children}</PanelLayout>;
}
