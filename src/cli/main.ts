#!/usr/bin/env node

import { runDoctor } from "../preflight/doctor.js";
import { renderDoctorReport } from "../preflight/render.js";

const HELP = `Codex Pool

Usage:
  codex-pool doctor [--json]
  codex-pool --help
  codex-pool --version
`;

function main(args: string[]): number {
  const [command, ...options] = args;

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }

  if (command === "--version" || command === "-V") {
    process.stdout.write("0.1.0\n");
    return 0;
  }

  if (command === "doctor") {
    const unknownOption = options.find((option) => option !== "--json");
    if (unknownOption) {
      process.stderr.write(`Unknown option: ${unknownOption}\n`);
      return 2;
    }

    const report = runDoctor();
    process.stdout.write(
      options.includes("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${renderDoctorReport(report)}\n`,
    );
    return report.ready ? 0 : 1;
  }

  process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}

process.exitCode = main(process.argv.slice(2));

