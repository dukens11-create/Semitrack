import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const supported = [
  "apps/api/",
  "apps/mobile-react-native/",
  "apps/admin/",
  ".github/workflows/",
];
const exactSupported = new Set(["render.yaml"]);

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .filter(file => supported.some(prefix => file.startsWith(prefix)) || exactSupported.has(file));

const deniedBasename = [
  /^\.env(?:\..+)?$/i,
  /^google-services\.json$/i,
  /^GoogleService-Info\.plist$/i,
  /^credentials\.properties$/i,
  /\.(?:p12|pfx|jks|keystore|mobileprovision)$/i,
  /^(?:id_rsa|id_ed25519)$/i,
];
const allowedExample = /(?:\.example|\.sample|\.template)$/i;

const tokenPatterns = [
  { name: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "mapbox-secret", regex: /\bsk\.[A-Za-z0-9._-]{20,}\b/g },
  { name: "stripe-live-secret", regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "resend-key", regex: /\bre_[A-Za-z0-9_-]{20,}\b/g },
];

const clearlySynthetic = text =>
  /fixture|synthetic|example|not[-_ ]a[-_ ]credential|your[_ -]|placeholder/i.test(text);

const findings = [];

for (const file of tracked) {
  const base = path.basename(file);
  if (!allowedExample.test(base) && deniedBasename.some(pattern => pattern.test(base))) {
    findings.push({ file, line: 0, kind: "tracked-sensitive-filename" });
    continue;
  }

  const absolute = path.join(root, file);
  const stat = fs.statSync(absolute);
  if (!stat.isFile() || stat.size > 2_000_000 || /package-lock\.json$/i.test(file)) continue;

  const raw = fs.readFileSync(absolute);
  if (raw.includes(0)) continue;
  const text = raw.toString("utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (clearlySynthetic(line)) continue;
    for (const pattern of tokenPatterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        findings.push({ file, line: index + 1, kind: pattern.name });
      }
    }
  }
}

if (findings.length) {
  console.error("Release-source hygiene check failed.");
  for (const finding of findings) {
    console.error(
      finding.line
        ? `${finding.file}:${finding.line} [${finding.kind}]`
        : `${finding.file} [${finding.kind}]`,
    );
  }
  process.exit(1);
}

console.log(
  `PASS: ${tracked.length} tracked files in supported release roots contain no high-confidence secret artifacts.`,
);
