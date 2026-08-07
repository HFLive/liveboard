// @vitest-environment node

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

describe("authentication middleware", () => {
  it("redirects an unauthenticated app request to login", () => {
    const response = middleware(
      new NextRequest("https://liveboard.test/app/content"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://liveboard.test/login",
    );
  });

  it("allows app requests carrying a session cookie", () => {
    const request = new NextRequest("https://liveboard.test/app/content", {
      headers: { cookie: "liveboard_session=signed-value" },
    });

    expect(middleware(request).headers.get("x-middleware-next")).toBe("1");
  });

  it("allows the separate HTTP session cookie over HTTP", () => {
    const request = new NextRequest("http://liveboard.test/app/content", {
      headers: { cookie: "liveboard_session_http=signed-value" },
    });

    expect(middleware(request).headers.get("x-middleware-next")).toBe("1");
  });

  it("accepts an HTTP session cookie over HTTPS (cookie name is not protocol-derived)", () => {
    const request = new NextRequest("https://liveboard.test/app/content", {
      headers: { cookie: "liveboard_session_http=signed-value" },
    });

    expect(middleware(request).headers.get("x-middleware-next")).toBe("1");
  });

  it("accepts an HTTP session cookie behind a forwarded HTTPS proxy", () => {
    const request = new NextRequest("http://liveboard.test/app/content", {
      headers: {
        cookie: "liveboard_session_http=signed-value",
        "x-forwarded-proto": "https",
      },
    });

    expect(middleware(request).headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects an authenticated login request into the app", () => {
    const request = new NextRequest("https://liveboard.test/login", {
      headers: { cookie: "liveboard_session=signed-value" },
    });

    const response = middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://liveboard.test/app/classrooms",
    );
  });

  it("does not bounce a session-expired login back into the app", () => {
    const request = new NextRequest(
      "https://liveboard.test/login?reason=session-expired",
      { headers: { cookie: "liveboard_session=signed-value" } },
    );

    expect(middleware(request).headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects an authenticated root request into the app", () => {
    const request = new NextRequest("https://liveboard.test/", {
      headers: { cookie: "liveboard_session_http=signed-value" },
    });

    const response = middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://liveboard.test/app/classrooms",
    );
  });

  it("shows the marketing page to an unauthenticated root request", () => {
    expect(
      middleware(new NextRequest("https://liveboard.test/")).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
  });

  it("allows public login requests", () => {
    expect(
      middleware(new NextRequest("https://liveboard.test/login")).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
  });
});
