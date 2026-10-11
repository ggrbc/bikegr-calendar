/** The Managers actions: who gets which email, and how a refusal reads. The writes are mocked. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addManager: vi.fn(),
  removeManager: vi.fn(),
  signIn: vi.fn(async () => {}),
  notifyManagerGranted: vi.fn(async () => true),
  createTransport: vi.fn(() => ({ kind: "capture", send: async () => {} })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/auth", () => ({ signIn: mocks.signIn }));
vi.mock("@/auth/dal", () => ({ requireEditor: async () => ({ id: "e1", role: "editor" }) }));
vi.mock("@/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: async () => [{ title: "Tuesday Ride" }] }) }) }),
}));
vi.mock("@/admin/events/managers", () => ({ addManager: mocks.addManager, removeManager: mocks.removeManager }));
vi.mock("@/email/transport", () => ({ createEmailTransport: mocks.createTransport }));
vi.mock("@/email/notify", () => ({ appOrigin: () => "http://localhost:3000", notifyManagerGranted: mocks.notifyManagerGranted }));

import { addManagerAction, removeManagerAction } from "./managers-actions";

const EVENT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PERSON = "8c9e6679-7425-40de-944b-e07fc1f90ae7";
const idle = { result: "idle" } as const;
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};
const sam = { id: PERSON, email: "sam@example.org", name: "Sam Leader" };

describe("Managers actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a new person gets the invite magic link and no grant email", async () => {
    mocks.addManager.mockResolvedValue({ ok: true, kind: "invited", editor: sam });
    const state = await addManagerAction(idle, form({ eventId: EVENT, email: sam.email, name: sam.name }));
    expect(state).toMatchObject({ result: "ok" });
    expect(mocks.signIn).toHaveBeenCalledWith("resend", expect.objectContaining({ email: sam.email, redirect: false }));
    expect(mocks.notifyManagerGranted).not.toHaveBeenCalled();
  });

  it("an existing account gets the grant email and no magic link", async () => {
    mocks.addManager.mockResolvedValue({ ok: true, kind: "granted", editor: sam });
    await addManagerAction(idle, form({ eventId: EVENT, email: sam.email, name: "" }));
    expect(mocks.notifyManagerGranted).toHaveBeenCalledWith(
      expect.anything(),
      { to: sam.email, title: "Tuesday Ride" },
      "http://localhost:3000",
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("a grant email that did not send is said so, and the grant stays", async () => {
    mocks.addManager.mockResolvedValue({ ok: true, kind: "granted", editor: sam });
    mocks.notifyManagerGranted.mockResolvedValueOnce(false);
    const state = await addManagerAction(idle, form({ eventId: EVENT, email: sam.email, name: "" }));
    expect(state).toMatchObject({
      result: "ok",
      message: "Sam Leader can now manage Tuesday Ride. The email did not send.",
    });
  });

  it("a transport that cannot be made counts as an email that did not send", async () => {
    mocks.addManager.mockResolvedValue({ ok: true, kind: "granted", editor: sam });
    mocks.createTransport.mockImplementationOnce(() => {
      throw new Error("no transport");
    });
    const state = await addManagerAction(idle, form({ eventId: EVENT, email: sam.email, name: "" }));
    expect(state).toMatchObject({ message: "Sam Leader can now manage Tuesday Ride. The email did not send." });
    expect(mocks.notifyManagerGranted).not.toHaveBeenCalled();
  });

  it("a second grant sends nothing", async () => {
    mocks.addManager.mockResolvedValue({ ok: true, kind: "already", editor: sam });
    const state = await addManagerAction(idle, form({ eventId: EVENT, email: sam.email, name: "" }));
    expect(state).toMatchObject({ result: "ok", message: "Sam Leader already manages this Event." });
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.notifyManagerGranted).not.toHaveBeenCalled();
  });

  it("a refusal shows its message and keeps the typed values", async () => {
    mocks.addManager.mockResolvedValue({
      ok: false,
      reason: "invalid",
      message: "x",
      errors: { email: "Drew Wagner is an Editor and can already change every Event." },
    });
    const state = await addManagerAction(idle, form({ eventId: EVENT, email: "drew@example.org", name: "Drew" }));
    expect(state).toMatchObject({
      result: "error",
      message: "Drew Wagner is an Editor and can already change every Event.",
      values: { email: "drew@example.org", name: "Drew" },
    });
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("a bad Event id never reaches the write", async () => {
    expect(await addManagerAction(idle, form({ eventId: "nope", email: "a@b.org", name: "A" }))).toMatchObject({ result: "error" });
    expect(mocks.addManager).not.toHaveBeenCalled();
  });

  it("remove calls the write with the Editor from the session", async () => {
    mocks.removeManager.mockResolvedValue({ ok: true });
    expect(await removeManagerAction(idle, form({ eventId: EVENT, editorId: PERSON }))).toMatchObject({ result: "ok" });
    expect(mocks.removeManager).toHaveBeenCalledWith(expect.anything(), { id: "e1", role: "editor" }, { eventId: EVENT, editorId: PERSON });
  });
});
