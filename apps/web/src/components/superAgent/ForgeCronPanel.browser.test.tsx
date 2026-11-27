import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import "../../index.css";
import { render } from "../../../test/render";
import { ForgeCronLauncher, ForgeCronSurface } from "./ForgeCronPanel";

vi.mock(import("../../state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({
    data: {
      origin: "https://forge.example",
      actor: "user@example.com",
      tasks: Array.from({ length: 11 }, (_, i) => ({
        id: `native-${i}`,
        title: `Native task ${i}`,
        prompt: `Check service ${i}`,
        enabled: false,
        schedule: { type: "interval", everyMs: 3600000 },
        lastRunStatus: "never",
        nextRunAt: null,
        lastRunAt: null,
        lastRunError: null,
      })),
      legacy: [],
      sessions: [],
      nextCursor: null,
    },
    error: null,
    isPending: false,
    refresh: () => {},
  })) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
    environments: [
      { environmentId: "isolated", label: "Local test", connection: { phase: "connected" } },
      { environmentId: "offline", label: "Offline machine", connection: { phase: "disconnected" } },
    ],
  })) as never,
}));
const environmentId = EnvironmentId.make("isolated");
function Harness({ compact = false }: { compact?: boolean }) {
  const launcher = <ForgeCronLauncher environmentId={environmentId} />;
  return (
    <>
      {compact ? <section>{launcher}</section> : <nav>{launcher}</nav>}
      <ForgeCronSurface />
    </>
  );
}
it("keeps the schedule sheet open when the responsive sidebar remounts its launcher, then closes and reopens it", async () => {
  const registry = AtomRegistry.make();
  await using screen = await render(
    <RegistryContext value={registry}>
      <Harness />
    </RegistryContext>,
  );
  await screen.getByRole("button", { name: "Scheduled sessions" }).click();
  await expect.element(page.getByRole("dialog", { name: "Scheduled sessions" })).toBeVisible();
  await screen.rerender(
    <RegistryContext value={registry}>
      <Harness compact />
    </RegistryContext>,
  );
  await expect.element(page.getByRole("dialog", { name: "Scheduled sessions" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect
    .element(page.getByRole("dialog", { name: "Scheduled sessions" }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Scheduled sessions" }).click();
  await expect.element(page.getByRole("dialog", { name: "Scheduled sessions" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect
    .element(page.getByRole("dialog", { name: "Scheduled sessions" }))
    .not.toBeInTheDocument();
});

it("lists native T3 schedules, pages and searches them, and distinguishes offline environments", async () => {
  const registry = AtomRegistry.make();
  await using screen = await render(
    <RegistryContext value={registry}>
      <Harness />
    </RegistryContext>,
  );
  await screen.getByRole("button", { name: "Scheduled sessions" }).click();
  await page.getByRole("tab", { name: "T3 native", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Native task 0", exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByText("Environment offline. Its native schedules could not be checked."))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Native task 10", exact: true }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Native task 10", exact: true }))
    .toBeVisible();
  await page.getByRole("textbox", { name: "Search scheduled sessions" }).fill("service 2");
  await page.getByRole("button", { name: "Native task 2", exact: true }).click();
  await expect.element(page.getByText("Check service 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All T3 schedules" }).click();
  await expect
    .element(page.getByRole("button", { name: "Native task 2", exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
});
