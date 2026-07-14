module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  passWithNoTests: true,
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "coverage",
  coverageThreshold: {
    global: {
      statements: 30,
      branches: 22,
      functions: 34,
      lines: 30,
    },
  },
  testEnvironment: "node",
};
