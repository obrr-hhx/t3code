import { createContext, use, useState, type CSSProperties, type ReactNode } from "react";
import * as Schema from "effect/Schema";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useGT } from "gt-react";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "../../hooks/useResizableWidth";
import { observeResize } from "../../lib/observeResize";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";

const PanelLayout = createContext<{
  open: boolean;
  wide: boolean;
  nativeOpen: boolean;
  toggle: () => void;
  close: () => void;
} | null>(null);

export const useSuperAgentPanelLayout = () => use(PanelLayout);

export function SuperAgentPanelLayout({
  active,
  nativeOpen = false,
  children,
}: {
  active: boolean;
  nativeOpen?: boolean;
  children: ReactNode;
}) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const [desktopOpen, setDesktopOpen] = useLocalStorage(
    "herdr.manager-panel.open.v1",
    true,
    Schema.Boolean,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const open = !nativeOpen && (wide ? desktopOpen : mobileOpen);
  const setOpen = wide ? setDesktopOpen : setMobileOpen;
  const value = active
    ? { open, wide, nativeOpen, toggle: () => setOpen(!open), close: () => setOpen(false) }
    : null;
  return <PanelLayout value={value}>{children}</PanelLayout>;
}

/** Desktop manager column; the narrow-screen sheet retains its native sizing. */
export function SuperAgentPanelFrame({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  const gt = useGT();
  const minWidth = 280;
  const [maxWidth, setMaxWidth] = useState(720);
  const { width, setWidth, handlers } = useResizableWidth({
    storageKey: "herdr.manager-panel.width.v1",
    defaultWidth: 320,
    minWidth,
    maxWidth,
    edge: "left",
  });
  return (
    <div
      hidden={hidden}
      data-manager-panel
      className="relative min-w-0 shrink-0"
      ref={(host) => {
        const row = host?.parentElement;
        if (!row || !host) return;
        const content = row.querySelector<HTMLElement>(":scope > main");
        const measure = () => {
          const panelWidth = host.getBoundingClientRect().width;
          row.style.setProperty("--herdr-manager-panel-width", `${panelWidth}px`);
          // The row also contains the left sidebar. Reserve room within the chat + manager span.
          const available = content ? content.clientWidth + panelWidth : row.clientWidth;
          setMaxWidth(Math.max(minWidth, Math.min(720, available - 360)));
        };
        measure();
        const stopRow = observeResize(row, measure);
        const stopHost = observeResize(host, measure);
        const stopContent = content ? observeResize(content, measure) : undefined;
        return () => {
          stopRow();
          stopHost();
          stopContent?.();
          row.style.removeProperty("--herdr-manager-panel-width");
        };
      }}
      style={
        {
          [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
          width: `var(${RESIZABLE_WIDTH_PROPERTY})`,
        } as CSSProperties
      }
    >
      {!hidden ? (
        <RightPanelResizeHandle
          handlers={handlers}
          label={gt("Resize manager panel")}
          tabIndex={0}
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const next =
              event.key === "ArrowLeft"
                ? width + 16
                : event.key === "ArrowRight"
                  ? width - 16
                  : event.key === "Home"
                    ? minWidth
                    : event.key === "End"
                      ? maxWidth
                      : null;
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            setWidth(next);
          }}
        />
      ) : null}
      {children}
    </div>
  );
}
