// Sends an OTP and verifies a code read from stdin.
//
//   ROBASE_API_KEY=robe_... node examples/send-otp.mjs +2348012345678
//
// Run `npm run build` first, or change the import to '../src/index.ts' and run
// with a TypeScript-aware Node.
import { createInterface } from 'node:readline/promises';

import {
  ConflictError,
  InsufficientCreditsError,
  Robase,
  ValidationError,
} from '../dist/esm/index.js';

const phoneNumber = process.argv[2];
if (!phoneNumber) {
  console.error('usage: node examples/send-otp.mjs <phone-number-in-e164>');
  process.exit(1);
}

const robase = new Robase({ apiKey: process.env.ROBASE_API_KEY });

let sent;
try {
  sent = await robase.otp.send({
    phone_number: phoneNumber,
    code_length: 6,
    ttl_seconds: 300,
  });
} catch (error) {
  if (error instanceof InsufficientCreditsError) {
    console.error('out of credits — top up at https://robase.dev');
    process.exit(1);
  }
  if (error instanceof ValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

console.log(
  `sent ${sent.id} to ${sent.phone_number} (${sent.credit_cost} credit(s)), expires ${sent.expires_at}`,
);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('enter the code: ')).trim();
rl.close();

try {
  const result = await robase.otp.verify({ otp_id: sent.id, code });
  if (result.valid) {
    console.log('verified ✓');
  } else {
    console.log(`wrong code — ${result.attempts_remaining} attempt(s) left`);
  }
} catch (error) {
  if (error instanceof ConflictError) {
    console.error(`cannot verify: ${error.type}`);
    process.exit(1);
  }
  throw error;
}
