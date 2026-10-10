import type { Metadata } from "next";
import { Suspense } from "react";
import { googleSignInEnabled } from "@/auth";
import { SiteHeader } from "../_components/site-header";
import { GoogleButton } from "./google-button";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in — Bike GR Calendar" };

/** Messages for the `error` values that Auth.js sends to this page. */
const ERROR_MESSAGES: Record<string, string> = {
  Verification: "This sign-in link expired or was already used. Get a new link below.",
  AccessDenied: "You cannot sign in with this email. Ask an Admin.",
  OAuthAccountNotLinked: "You are signed in as another Editor. Sign out first, then sign in with Google.",
  OAuthCallbackError: "Google sign-in did not finish. Try again, or get a link by email.",
};

async function LinkError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  if (typeof error !== "string") return null;
  const message = ERROR_MESSAGES[error] ?? "Sign-in did not work. Try again, or get a new link below.";
  return (
    <p role="alert" className="mb-6 border-l-4 border-brand-orange bg-white px-4 py-3 font-normal text-brand-orange-text">
      {message}
    </p>
  );
}

/**
 * The Editor sign-in page, in the bikegr.org look of the public side (as `/submit`). "Sign in with
 * Google" shows only when the Google client is configured; the magic link always works.
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  const google = googleSignInEnabled();
  return (
    <>
      <SiteHeader />
      <main className="w-full flex-1 bg-brand-page text-[15.84px] font-light leading-[1.9] text-brand-gray">
        <div className="mx-auto max-w-[480px] px-6 py-12 sm:py-16">
          <h1 className="mb-4 font-chivo text-[34px] font-normal leading-tight sm:text-[46.72px]">Sign in</h1>
          <p className="mb-8">
            {google
              ? "Editors sign in with Google or with a link by email. There are no passwords."
              : "Editors sign in with a link sent by email. There are no passwords."}
          </p>
          <Suspense>
            <LinkError searchParams={searchParams} />
          </Suspense>
          {google && (
            <>
              <GoogleButton />
              <div className="my-6 flex items-center gap-4 text-[14px]" aria-hidden="true">
                <span className="h-px flex-1 bg-brand-divider" />
                or
                <span className="h-px flex-1 bg-brand-divider" />
              </div>
            </>
          )}
          <LoginForm />
        </div>
      </main>
    </>
  );
}
