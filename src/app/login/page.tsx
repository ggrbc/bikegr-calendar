import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in — Bike GR Calendar" };

/** Messages for the `error` values that Auth.js sends to this page. */
const ERROR_MESSAGES: Record<string, string> = {
  Verification: "This sign-in link expired or was already used. Get a new link below.",
  AccessDenied: "You cannot sign in with this email. Ask an Admin.",
};

async function LinkError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  if (typeof error !== "string") return null;
  const message = ERROR_MESSAGES[error] ?? "Sign-in did not work. Get a new link below.";
  return (
    <p role="alert" className="mb-4 rounded border border-red-700 bg-red-50 p-4 text-red-800">
      {message}
    </p>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto w-full max-w-md p-8">
      <h1 className="mb-2 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-gray-700">
        Editors sign in with a link sent by email. There are no passwords.
      </p>
      <Suspense>
        <LinkError searchParams={searchParams} />
      </Suspense>
      <LoginForm />
    </main>
  );
}
