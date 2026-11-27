import { expect, it, vi } from "vite-plus/test";
import stylesheet from "../../index.css?inline";
import { render } from "../../../test/render";
import { PanelLayoutControls, WorkspaceTitlebarControls } from "../chat/PanelLayoutControls";
import { SuperAgentPanelLayout, useSuperAgentPanelLayout } from "./panelLayout";

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

function Toolbar() {
  return (
    <WorkspaceTitlebarControls
      showMaximizeControl={false}
      rightPanelOpen={false}
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
        rightPanelAvailable={false}
        rightPanelOpen={false}
        rightPanelShortcutLabel={null}
        onToggleTerminal={() => {}}
        onToggleThreadPanel={() => {}}
        onToggleRightPanel={() => {
          throw new Error("worker toggle must not receive manager clicks");
        }}
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
