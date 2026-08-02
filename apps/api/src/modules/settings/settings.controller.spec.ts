import type { Response } from "express";
import {
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
      stream: { pipe: jest.fn() },
    });

    await controller.favicon(response as unknown as Response);

    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      PUBLIC_REVALIDATED_CACHE_CONTROL,
    );
  });
});
