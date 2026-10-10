/**
 * Test helper: a fake Google for the OAuth flow, with no network. Give `fetch` to the Google
 * provider (`[customFetch]`, through `AuthDeps.google.fetch`). It answers the OIDC discovery
 * request and the token request. The token response holds an ID token signed RS256 with a key that
 * the helper makes with WebCrypto. Use only in tests.
 */

export const FAKE_GOOGLE_ISSUER = "https://accounts.google.com";
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** The claims that a test case picks. The helper adds `iss`, `aud`, `azp`, `iat`, and `exp`. */
export interface FakeGoogleClaims {
  sub: string;
  email: string;
  email_verified?: boolean;
  hd?: string;
}

export interface FakeGoogle {
  fetch: typeof fetch;
  /** Stores the claims and returns the authorization code that gets them at the token endpoint. */
  issueCode(claims: FakeGoogleClaims): string;
  /** The bodies of the token requests, so a test can check PKCE. */
  tokenRequests: URLSearchParams[];
}

function base64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  return Buffer.from(bytes).toString("base64url");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function createFakeGoogle(clientId: string): Promise<FakeGoogle> {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const codes = new Map<string, FakeGoogleClaims>();
  const tokenRequests: URLSearchParams[] = [];

  async function idToken(claims: FakeGoogleClaims): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "fake-google" }));
    const payload = base64url(
      JSON.stringify({ iss: FAKE_GOOGLE_ISSUER, aud: clientId, azp: clientId, iat: now, exp: now + 3600, ...claims }),
    );
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${base64url(signature)}`;
  }

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.href === `${FAKE_GOOGLE_ISSUER}/.well-known/openid-configuration`) {
      return json({
        issuer: FAKE_GOOGLE_ISSUER,
        authorization_endpoint: AUTHORIZATION_ENDPOINT,
        token_endpoint: TOKEN_ENDPOINT,
        // Auth.js needs it in the metadata; for OIDC it reads the ID token and never calls it.
        userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["plain", "S256"],
      });
    }
    if (url.href === TOKEN_ENDPOINT && init?.method === "POST") {
      const body = new URLSearchParams(String(init.body));
      tokenRequests.push(body);
      const claims = codes.get(body.get("code") ?? "");
      if (!claims) return json({ error: "invalid_grant" }, 400);
      codes.delete(body.get("code") ?? "");
      return json({
        access_token: "fake-google-access-token",
        token_type: "Bearer",
        expires_in: 3599,
        scope: "openid https://www.googleapis.com/auth/userinfo.email",
        id_token: await idToken(claims),
      });
    }
    throw new Error(`fake Google: unexpected request ${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
  };

  let next = 0;
  return {
    fetch: fakeFetch,
    tokenRequests,
    issueCode(claims) {
      const code = `fake-code-${++next}`;
      codes.set(code, claims);
      return code;
    },
  };
}
