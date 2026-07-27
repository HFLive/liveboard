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

  it("does not use an HTTP session cookie over HTTPS", () => {
    const request = new NextRequest("https://liveboard.test/app/content", {
      headers: { cookie: "liveboard_session_http=signed-value" },
    });

    expect(middleware(request).status).toBe(307);
  });

  it("uses the forwarded protocol behind Nginx", () => {
    const request = new NextRequest("http://liveboard.test/app/content", {
      headers: {
        cookie: "liveboard_session_http=signed-value",
        "x-forwarded-proto": "https",
      },
    });

    expect(middleware(request).status).toBe(307);
  });

  it("allows public login requests", () => {
    expect(
      middleware(new NextRequest("https://liveboard.test/login")).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
  });
});
