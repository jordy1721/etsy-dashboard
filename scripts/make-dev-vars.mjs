// Runs before `npm run dev`. If you have no .dev.vars file yet, it makes one
// with a simple passcode for LOCAL testing only. The file is git-ignored.
// The real passcode is a Cloudflare secret and is never stored in a file.
import { existsSync, writeFileSync } from "node:fs";

if (!existsSync(".dev.vars")) {
  writeFileSync(".dev.vars", "# Local testing only. Never commit this file.\nDASHBOARD_PASSCODE=letmein\n");
  console.log('Created .dev.vars for local testing. Local passcode: "letmein"');
}
