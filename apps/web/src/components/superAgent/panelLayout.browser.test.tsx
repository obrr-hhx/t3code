import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import stylesheet from "../../index.css?inline";
import { act, render } from "../../../test/render";
import { PanelLayoutControls, WorkspaceTitlebarControls } from "../chat/PanelLayoutControls";
import {
  SuperAgentPanelFrame,
  SuperAgentPanelLayout,
  useSuperAgentPanelLayout,
} from "./panelLayout";

const viewport = vi.hoisted(() => ({ wide: true }));
vi.mock(import("../../hooks/useMediaQuery"), () => ({ useMediaQuery: () => viewport.wide }));

function Harness({ active = true }: { active?: boolean }) {
  return (
    <SuperAgentPanelLayout active={active}>
      <style>{stylesheet}</style>
      <Toolbar />
      <div className="pt-20">
        <Controls />
      </div>
    </SuperAgentPanelLayout>
  );
}
function Controls() {
  const panel = useSuperAgentPanelLayout();
  if (!panel) return <p>ordinary thread</p>;
  return (
    <>
      <button onClick={panel.toggle}>toggle manager</button>
      {panel.open ? (
        <aside aria-label="manager">
          <button onClick={panel.close}>close manager</button>
        </aside>
      ) : null}
    </>
  );
}
it("closes, reopens and remembers the manager panel across remounts", async () => {
  localStorage.removeItem("herdr.manager-panel.open.v1");
  await using screen = await render(<Harness />);
  await expect.element(screen.getByRole("complementary", { name: "manager" })).toBeVisible();
  await screen.getByRole("button", { name: "close manager" }).click();
  await expect
    .element(screen.getByRole("complementary", { name: "manager" }))
    .not.toBeInTheDocument();
  await screen.rerender(<div />);
  await screen.rerender(<Harness />);
  await expect
    .element(screen.getByRole("complementary", { name: "manager" }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "toggle manager" }).click();
  await expect.element(screen.getByRole("complementary", { name: "manager" })).toBeVisible();
});
it("does not replace panel controls on ordinary worker threads", async () => {
  await using screen = await render(<Harness active={false} />);
  await expect.element(screen.getByText("ordinary thread")).toBeVisible();
});

it("uses a dismissible sheet on narrow screens without changing the desktop preference", async () => {
  viewport.wide = false;
  localStorage.setItem("herdr.manager-panel.open.v1", "true");
  await using screen = await render(<Harness />);
  await expect
    .element(screen.getByRole("complementary", { name: "manager" }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "toggle manager" }).click();
  await expect.element(screen.getByRole("complementary", { name: "manager" })).toBeVisible();
  await screen.getByRole("button", { name: "close manager" }).click();
  expect(localStorage.getItem("herdr.manager-panel.open.v1")).toBe("true");
  viewport.wide = true;
});

function Toolbar({
  nativeOpen = false,
  onToggleNative = () => {
    throw new Error("worker toggle must not receive manager clicks");
  },
}: {
  nativeOpen?: boolean;
  onToggleNative?: () => void;
}) {
  return (
    <WorkspaceTitlebarControls
      showMaximizeControl={false}
      rightPanelOpen={nativeOpen}
      animationsActive={false}
      maximized={false}
      onToggleMaximized={() => {}}
    >
      <PanelLayoutControls
        terminalAvailable={false}
        terminalOpen={false}
        terminalShortcutLabel={null}
        threadPanelOpen={false}
        threadPanelPresentation="inline"
        threadPanelShortcutLabel={null}
        rightPanelAvailable={nativeOpen}
        rightPanelOpen={nativeOpen}
        rightPanelShortcutLabel={null}
        onToggleTerminal={() => {}}
        onToggleThreadPanel={() => {}}
        onToggleRightPanel={onToggleNative}
      />
    </WorkspaceTitlebarControls>
  );
}
it("routes the real toolbar toggle to manager state and hides it behind a narrow sheet", async () => {
  viewport.wide = true;
  localStorage.setItem("herdr.manager-panel.open.v1", "true");
  await using screen = await render(<Harness />);
  const toggle = screen.getByRole("button", { name: "Toggle right panel" });
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  viewport.wide = false;
  await screen.rerender(<div />);
  await screen.rerender(<Harness />);
  await screen.getByRole("button", { name: "toggle manager" }).click();
  const toolbar = screen.container.querySelector<HTMLElement>(
    "[data-workspace-titlebar-controls]",
  )!;
  expect(getComputedStyle(toolbar).display).toBe("none");
  await screen.getByRole("button", { name: "close manager" }).click();
  await expect.element(toggle).toBeVisible();
  viewport.wide = true;
});

function NativePanelHarness() {
  const [nativeOpen, setNativeOpen] = useState(true);
  return (
    <SuperAgentPanelLayout active nativeOpen={nativeOpen}>
      <style>{stylesheet}</style>
      <Toolbar nativeOpen={nativeOpen} onToggleNative={() => setNativeOpen(!nativeOpen)} />
      <div className="pt-20">
        {nativeOpen ? <section aria-label="PR details">PR details</section> : null}
        <Controls />
        <button onClick={() => setNativeOpen(true)}>open PR</button>
      </div>
    </SuperAgentPanelLayout>
  );
}
it("closes native PR details before switching the same toggle back to goals", async () => {
  viewport.wide = true;
  localStorage.setItem("herdr.manager-panel.open.v1", "true");
  await using screen = await render(<NativePanelHarness />);
  const toggle = screen.getByRole("button", { name: "Toggle right panel" });
  await expect.element(screen.getByRole("region", { name: "PR details" })).toBeVisible();
  await expect
    .element(screen.getByRole("complementary", { name: "manager" }))
    .not.toBeInTheDocument();
  await toggle.click();
  await expect.element(screen.getByRole("region", { name: "PR details" })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("complementary", { name: "manager" })).toBeVisible();
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect.element(screen.getByRole("complementary", { name: "manager" })).toBeVisible();
  await screen.getByRole("button", { name: "open PR" }).click();
  await expect.element(screen.getByRole("region", { name: "PR details" })).toBeVisible();
  await toggle.click();
  await expect.element(screen.getByRole("region", { name: "PR details" })).not.toBeInTheDocument();
});

function ResizeHarness({
  rowWidth = 1100,
  hidden = false,
  sidebarWidth = 0,
}: {
  rowWidth?: number;
  hidden?: boolean;
  sidebarWidth?: number;
}) {
  return (
    <div style={{ display: "flex", width: rowWidth }}>
      <style>{stylesheet}</style>
      <nav style={{ width: sidebarWidth, flexShrink: 0 }}>sidebar</nav>
      <main style={{ flex: 1, minWidth: 0 }}>chat</main>
      <SuperAgentPanelFrame hidden={hidden}>
        <p>manager content</p>
      </SuperAgentPanelFrame>
    </div>
  );
}
it("drags the manager edge, persists only on release, clamps bounds and retains width across remounts", async () => {
  localStorage.removeItem("herdr.manager-panel.width.v1");
  using _capture = vi
    .spyOn(HTMLElement.prototype, "setPointerCapture")
    .mockImplementation(() => {});
  await using screen = await render(<ResizeHarness />);
  const host = () => screen.container.querySelector<HTMLElement>("[data-manager-panel]")!;
  const drag = async (delta: number) => {
    const handle = host().querySelector<HTMLElement>('[role="separator"]')!;
    const init = { bubbles: true, button: 0, pointerId: 5, clientX: 500 };
    await act(() => handle.dispatchEvent(new PointerEvent("pointerdown", init)));
    await act(() =>
      handle.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: 500 + delta })),
    );
    await act(() =>
      handle.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: 500 + delta })),
    );
  };
  expect(host().getBoundingClientRect().width).toBe(320);
  expect(localStorage.getItem("herdr.manager-panel.width.v1")).toBeNull();
  await drag(-160);
  expect(host().getBoundingClientRect().width).toBe(480);
  expect(JSON.parse(localStorage.getItem("herdr.manager-panel.width.v1")!)).toBe(480);
  await screen.rerender(<div />);
  await screen.rerender(<ResizeHarness />);
  expect(host().getBoundingClientRect().width).toBe(480);
  await drag(-2000);
  expect(host().getBoundingClientRect().width).toBe(720);
  await drag(2000);
  expect(host().getBoundingClientRect().width).toBe(280);
  await userEvent.keyboard("{Tab}");
  await userEvent.keyboard("{ArrowLeft}");
  expect(host().getBoundingClientRect().width).toBe(296);
  await userEvent.keyboard("{End}");
  expect(host().getBoundingClientRect().width).toBe(720);
  await screen.rerender(<ResizeHarness rowWidth={760} />);
  await expect.poll(() => host().getBoundingClientRect().width).toBe(400);
  await screen.rerender(<ResizeHarness rowWidth={1100} />);
  await expect.poll(() => host().getBoundingClientRect().width).toBe(720);
  await screen.rerender(<ResizeHarness hidden />);
  await expect
    .element(screen.getByRole("separator", { name: "Resize manager panel" }))
    .not.toBeInTheDocument();
});

it("reserves chat space after accounting for the left sidebar", async () => {
  localStorage.setItem("herdr.manager-panel.width.v1", "720");
  await using screen = await render(<ResizeHarness rowWidth={1100} sidebarWidth={256} />);
  const host = screen.container.querySelector<HTMLElement>("[data-manager-panel]")!;
  await expect.poll(() => host.getBoundingClientRect().width).toBe(484);
  expect(screen.container.querySelector("main")!.getBoundingClientRect().width).toBe(360);
  await expect
    .poll(() => host.parentElement!.style.getPropertyValue("--herdr-manager-panel-width"))
    .toBe("484px");
});
