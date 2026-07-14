import { describe, expect, it } from "vitest";
import {
  contentDetail,
  contentPresentation,
  exerciseDetail,
  exerciseSubmissions,
  forumThread,
  teachingEdit,
  teachingPresent,
} from "./routes";

describe("dynamic application routes", () => {
  it.each([
    [contentDetail, "/app/content/a%2Fb%20c"],
    [contentPresentation, "/app/content/a%2Fb%20c/present"],
    [exerciseDetail, "/app/exercises/a%2Fb%20c"],
    [exerciseSubmissions, "/app/exercises/a%2Fb%20c/submissions"],
    [forumThread, "/app/forum/a%2Fb%20c"],
    [teachingEdit, "/app/teaching/a%2Fb%20c/edit"],
    [teachingPresent, "/app/teaching/a%2Fb%20c/present"],
  ])("encodes route identifiers", (routeBuilder, expected) => {
    expect(routeBuilder("a/b c")).toBe(expected);
  });
});
