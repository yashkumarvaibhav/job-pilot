#!/usr/bin/env node
import { assertDemoEnvironment } from "./config.mjs";

try {
  const configuration = assertDemoEnvironment();
  console.log(`demo safety preflight passed for ${configuration.accountEmail}`);
} catch (error) {
  console.error(`demo safety preflight refused: ${error.message}`);
  process.exitCode = 1;
}
