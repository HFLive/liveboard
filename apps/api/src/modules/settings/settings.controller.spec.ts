import type { Response } from "express";
import {
  PRIVATE_SHORT_CACHE_CONTROL,
  PUBLIC_IMMUTABLE_CACHE_CONTROL,
  PUBLIC_REVALIDATED_CACHE_CONTROL,
} from "../../common/cache-control";
import { SettingsController } from "./settings.controller";
import type { SettingsService } from "./settings.service";

describe("SettingsController cache policy", () => {
  const settingsService = {
    getPublicSettings: jest.fn(),
    getFavicon: jest.fn(),
  };
  const response = {
    redirect: jest.fn(),
    setHeader: jest.fn(),
  };
  let controller: SettingsController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new SettingsController(
      settingsService as unknown as SettingsService,
    );
  });

  it("stores public settings but revalidates them before reuse", async () => {
    settingsService.getPublicSettings.mockResolvedValue({ timeZone: "UTC" });

    await controller.publicSettings(response as unknown as Response);

    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      PUBLIC_REVALIDATED_CACHE_CONTROL,
    );
  });

  it("caches versioned uploaded favicon bytes as public immutable content", async () => {
    const stream = { pipe: jest.fn() };
    settingsService.getFavicon.mockResolvedValue({
      mimeType: "image/png",
      redirectUrl: null,
      stream,
    });

    await controller.favicon(response as unknown as Response, "7");

    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      PUBLIC_IMMUTABLE_CACHE_CONTROL,
    );
    expect(stream.pipe).toHaveBeenCalledWith(response);
  });

  it("revalidates an unversioned favicon URL instead of caching it forever", async () => {
    settingsService.getFavicon.mockResolvedValue({
      mimeType: "image/png",
      redirectUrl: null,
      stream: { pipe: jest.fn() },
    });

    await controller.favicon(response as unknown as Response);

    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      PUBLIC_REVALIDATED_CACHE_CONTROL,
    );
  });

  it("briefly caches a signed favicon redirect within its lifetime", async () => {
    settingsService.getFavicon.mockResolvedValue({
      mimeType: "image/png",
      redirectUrl: "https://r2.example/signed-favicon",
      stream: null,
    });

    await controller.favicon(response as unknown as Response, "7");

    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      PRIVATE_SHORT_CACHE_CONTROL,
    );
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      "https://r2.example/signed-favicon",
    );
    expect(response.setHeader).not.toHaveBeenCalledWith(
      "Cache-Control",
      PUBLIC_IMMUTABLE_CACHE_CONTROL,
    );
  });
});
